/**
 * Unified printer service.
 *
 *  - Android: Bluetooth Classic SPP (react-native-bluetooth-classic) + BLE (react-native-ble-plx)
 *  - iOS:     BLE (react-native-ble-plx) + AirPrint (expo-print)
 *  - Web:     Web Bluetooth (Chrome/Edge, BLE printers) + system print dialog (hidden iframe)
 *
 * Native Bluetooth modules are loaded lazily and guarded, so the app never crashes in
 * Expo Go or on web where they are missing; `getCapabilities()` reports what works.
 * All print jobs go through one queue so two prints never interleave on a printer.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import * as Print from 'expo-print';
import type { BleManager, Characteristic, Device as BleDevice } from 'react-native-ble-plx';
import type RNBluetoothClassic from 'react-native-bluetooth-classic';

import {
  buildKotEscPos,
  buildKotHtml,
  buildReceiptEscPos,
  buildReceiptHtml,
  type EscPosReceiptOptions,
  type KotData,
  type PaperWidth,
  type ReceiptData,
} from './receipt';

export type PrinterKind = 'bt-classic' | 'ble' | 'web-bluetooth' | 'system';

export interface PrinterDevice {
  id: string;
  name: string;
  kind: PrinterKind;
  address?: string;
}

export interface PrinterCapabilities {
  btClassic: boolean;
  ble: boolean;
  webBluetooth: boolean;
  system: true;
}

/** Pseudo-device for the OS print dialog (AirPrint / Android print service / browser dialog). */
export const SYSTEM_PRINTER: PrinterDevice = { id: 'system', name: 'System print dialog', kind: 'system' };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PrinterErrorCode =
  | 'UNAVAILABLE'
  | 'UNSUPPORTED'
  | 'PERMISSION_DENIED'
  | 'BLUETOOTH_OFF'
  | 'NOT_FOUND'
  | 'CANCELLED'
  | 'CONNECT_FAILED'
  | 'NO_WRITABLE_CHARACTERISTIC'
  | 'WRITE_FAILED'
  | 'TIMEOUT'
  | 'PRINT_FAILED';

const DEFAULT_MESSAGES: Record<PrinterErrorCode, string> = {
  UNAVAILABLE: 'Bluetooth printing is not available here. Install the Tallyko app build (Bluetooth does not work in Expo Go).',
  UNSUPPORTED: 'This printer type is not supported on this device.',
  PERMISSION_DENIED: 'Bluetooth permission was denied. Allow "Nearby devices" for Tallyko in Settings and try again.',
  BLUETOOTH_OFF: 'Bluetooth is turned off. Turn it on and try again.',
  NOT_FOUND: 'Printer not found. Make sure it is switched on, nearby and paired.',
  CANCELLED: 'Printer selection was cancelled.',
  CONNECT_FAILED: 'Could not connect to the printer. Check that it is on, has paper and is not connected to another phone.',
  NO_WRITABLE_CHARACTERISTIC: 'This Bluetooth device does not look like a printer (no writable channel found).',
  WRITE_FAILED: 'Printing stopped midway. Check the printer and try again.',
  TIMEOUT: 'The printer did not respond in time. Move closer to the printer and try again.',
  PRINT_FAILED: 'Printing failed. Please try again.',
};

export class PrinterError extends Error {
  readonly code: PrinterErrorCode;
  readonly cause?: unknown;
  constructor(code: PrinterErrorCode, message?: string, cause?: unknown) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = 'PrinterError';
    this.code = code;
    this.cause = cause;
  }
}

const isPrinterError = (e: unknown): e is PrinterError => e instanceof PrinterError;
const wrap = (code: PrinterErrorCode, e: unknown) => (isPrinterError(e) ? e : new PrinterError(code, undefined, e));

function withTimeout<T>(p: Promise<T>, ms: number, code: PrinterErrorCode = 'TIMEOUT'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new PrinterError(code)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface PrintTuning {
  /** Max BLE write size on native (further capped by MTU - 3). */
  bleChunkSize: number;
  /** Write size for Web Bluetooth (no MTU info available; 20 is always safe). */
  webChunkSize: number;
  /** Delay between BLE chunks (ms) so cheap printers' buffers don't overflow. */
  bleChunkDelayMs: number;
  /** Chunk size for Bluetooth Classic writes. */
  classicChunkSize: number;
  classicChunkDelayMs: number;
  connectTimeoutMs: number;
  writeTimeoutMs: number;
}

const tuning: PrintTuning = {
  bleChunkSize: 180,
  webChunkSize: 20,
  bleChunkDelayMs: 10,
  classicChunkSize: 1024,
  classicChunkDelayMs: 20,
  connectTimeoutMs: 12000,
  writeTimeoutMs: 10000,
};

export function setPrintTuning(patch: Partial<PrintTuning>): PrintTuning {
  Object.assign(tuning, patch);
  return { ...tuning };
}

// ---------------------------------------------------------------------------
// Base64 (local encoder - no Buffer/btoa dependency)
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rem === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  const n = Math.max(1, Math.floor(size));
  for (let i = 0; i < bytes.length; i += n) chunks.push(bytes.subarray(i, Math.min(i + n, bytes.length)));
  return chunks;
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

/** Runs jobs strictly one after another (a failed job does not block the next). */
export function enqueuePrintJob<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Lazy native modules
// ---------------------------------------------------------------------------

type ClassicApi = typeof RNBluetoothClassic;

const isNative = () => Platform.OS === 'android' || Platform.OS === 'ios';

let classicApi: ClassicApi | null | undefined;
function loadClassic(): ClassicApi | null {
  if (classicApi !== undefined) return classicApi;
  classicApi = null;
  if (Platform.OS !== 'android' || !NativeModules.RNBluetoothClassic) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-bluetooth-classic');
    classicApi = (mod?.default ?? mod) as ClassicApi;
  } catch {
    classicApi = null;
  }
  return classicApi;
}

let bleManager: BleManager | null | undefined;
function loadBle(): BleManager | null {
  if (bleManager !== undefined) return bleManager;
  bleManager = null;
  if (!isNative() || !NativeModules.BlePlx) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-ble-plx');
    bleManager = new mod.BleManager() as BleManager;
  } catch {
    bleManager = null;
  }
  return bleManager;
}

// ---------------------------------------------------------------------------
// Web Bluetooth (minimal typings - not in TS DOM lib)
// ---------------------------------------------------------------------------

interface WebBtCharacteristic {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue?(data: Uint8Array): Promise<void>;
  writeValueWithResponse?(data: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
}
interface WebBtService {
  uuid: string;
  getCharacteristics(): Promise<WebBtCharacteristic[]>;
}
interface WebBtServer {
  connected: boolean;
  connect(): Promise<WebBtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<WebBtService[]>;
}
interface WebBtDevice {
  id: string;
  name?: string;
  gatt?: WebBtServer;
}
interface WebBluetooth {
  requestDevice(options: Record<string, unknown>): Promise<WebBtDevice>;
}

function webBluetooth(): WebBluetooth | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  const bt = (navigator as unknown as { bluetooth?: WebBluetooth }).bluetooth;
  return bt && typeof bt.requestDevice === 'function' ? bt : null;
}

/** Common GATT services exposed by BLE thermal printers. */
export const PRINTER_SERVICE_UUIDS: (number | string)[] = [
  0x18f0,
  0xff00,
  0xffe0,
  0xae30,
  0xfee7,
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];
const PRINTER_NAME_PREFIXES = ['PT', 'MTP', 'MPT', 'RPP', 'Printer', 'BlueTooth Printer', 'POS', 'Rugtek', 'RT', 'XP', 'TP', 'Inner', 'BT', 'HM', 'ZJ', 'GP', 'TVS', 'Everycom', 'EPSON', 'TM-'];

const fullUuid = (u: number | string) =>
  typeof u === 'number' ? `0000${u.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb` : u.toLowerCase();
const PREFERRED_SERVICES = PRINTER_SERVICE_UUIDS.map(fullUuid);
const servicePriority = (uuid: string) => {
  const i = PREFERRED_SERVICES.indexOf(uuid.toLowerCase());
  return i === -1 ? PREFERRED_SERVICES.length : i;
};

const webDevices = new Map<string, WebBtDevice>();

// ---------------------------------------------------------------------------
// Capabilities & permissions
// ---------------------------------------------------------------------------

export function getCapabilities(): PrinterCapabilities {
  let btClassic = false;
  let ble = false;
  try {
    btClassic = Platform.OS === 'android' && !!NativeModules.RNBluetoothClassic;
    ble = isNative() && !!NativeModules.BlePlx;
  } catch {
    // NativeModules lookup should never throw, but be defensive.
  }
  return { btClassic, ble, webBluetooth: !!webBluetooth(), system: true };
}

/** Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT; older Android: ACCESS_FINE_LOCATION. iOS/web: true. */
export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    const P = PermissionsAndroid.PERMISSIONS;
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT]);
      return Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
    }
    const r = await PermissionsAndroid.request(P.ACCESS_FINE_LOCATION);
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export interface ScanOptions {
  /** Web only: show every nearby BLE device in the browser chooser (for printers that advertise nothing useful). */
  showAllDevices?: boolean;
  /** Native: include BLE scan results (default true). */
  includeBle?: boolean;
}

const PRINTERISH = /print|pos|pt-?2|mtp|mpt|rpp|rugtek|xp-|tvs|thermal|receipt|bt-?58|bt-?80|zj|gp-/i;

export async function scanPrinters(timeoutMs = 8000, opts: ScanOptions = {}): Promise<PrinterDevice[]> {
  if (Platform.OS === 'web') return scanWeb(opts);

  const caps = getCapabilities();
  if (!caps.btClassic && !caps.ble) throw new PrinterError('UNAVAILABLE');
  if (!(await requestPermissions())) throw new PrinterError('PERMISSION_DENIED');

  const found = new Map<string, PrinterDevice>();
  const errors: unknown[] = [];

  const classic = caps.btClassic ? loadClassic() : null;
  if (classic) {
    try {
      let enabled = await classic.isBluetoothEnabled();
      if (!enabled) enabled = await classic.requestBluetoothEnabled().catch(() => false);
      if (!enabled) throw new PrinterError('BLUETOOTH_OFF');
      const bonded = await withTimeout(classic.getBondedDevices(), 8000);
      for (const d of bonded) {
        found.set(d.address, { id: d.address, address: d.address, name: d.name || d.address, kind: 'bt-classic' });
      }
    } catch (e) {
      errors.push(e);
    }
  }

  const ble = caps.ble && opts.includeBle !== false ? loadBle() : null;
  if (ble) {
    try {
      await waitForBlePoweredOn(ble);
      await new Promise<void>((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          void ble.stopDeviceScan();
          resolve();
        };
        Promise.resolve()
          .then(() =>
            ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
            if (error) {
              errors.push(error);
              finish();
              return;
            }
            if (!device) return;
            const name = device.name || device.localName;
            if (!name) return; // nameless beacons/headsets clutter the list
            if (found.has(device.id)) return; // dual-mode printer already listed as classic
            found.set(device.id, { id: device.id, name, kind: 'ble' });
            }),
          )
          .catch((e: unknown) => {
            errors.push(e);
            finish();
          });
        setTimeout(finish, Math.max(1000, timeoutMs));
      });
    } catch (e) {
      errors.push(e);
    }
  }

  const list = [...found.values()];
  if (list.length === 0 && errors.length) {
    const first = errors.find(isPrinterError);
    throw first ?? new PrinterError('NOT_FOUND', undefined, errors[0]);
  }
  // Printer-looking names first, then alphabetical.
  return list.sort((a, b) => {
    const pa = PRINTERISH.test(a.name) ? 0 : 1;
    const pb = PRINTERISH.test(b.name) ? 0 : 1;
    return pa - pb || a.name.localeCompare(b.name);
  });
}

async function waitForBlePoweredOn(ble: BleManager): Promise<void> {
  const state = await ble.state();
  if (state === 'PoweredOn') return;
  if (state === 'PoweredOff') throw new PrinterError('BLUETOOTH_OFF');
  if (state === 'Unauthorized') throw new PrinterError('PERMISSION_DENIED');
  if (state === 'Unsupported') throw new PrinterError('UNSUPPORTED');
  // Unknown / Resetting: iOS reports this briefly after the manager is created.
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new PrinterError('BLUETOOTH_OFF'));
    }, 4000);
    const sub = ble.onStateChange((s) => {
      if (s === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      } else if (s === 'PoweredOff' || s === 'Unauthorized' || s === 'Unsupported') {
        clearTimeout(timer);
        sub.remove();
        reject(new PrinterError(s === 'PoweredOff' ? 'BLUETOOTH_OFF' : s === 'Unauthorized' ? 'PERMISSION_DENIED' : 'UNSUPPORTED'));
      }
    }, true);
  });
}

async function scanWeb(opts: ScanOptions): Promise<PrinterDevice[]> {
  const bt = webBluetooth();
  if (!bt) {
    throw new PrinterError(
      'UNSUPPORTED',
      'This browser cannot connect to Bluetooth printers. Use Chrome or Edge (HTTPS), or print through the system print dialog.',
    );
  }
  const filtered = {
    filters: [
      ...PRINTER_SERVICE_UUIDS.map((s) => ({ services: [s] })),
      ...PRINTER_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
    ],
    optionalServices: PRINTER_SERVICE_UUIDS,
  };
  const all = { acceptAllDevices: true, optionalServices: PRINTER_SERVICE_UUIDS };
  let device: WebBtDevice;
  try {
    try {
      device = await bt.requestDevice(opts.showAllDevices ? all : filtered);
    } catch (e) {
      // Older Chromium builds reject some filter shapes with TypeError: fall back to all devices.
      if (!opts.showAllDevices && e instanceof TypeError) device = await bt.requestDevice(all);
      else throw e;
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotFoundError' || name === 'AbortError') return []; // user cancelled the chooser
    if (name === 'SecurityError') {
      throw new PrinterError('PERMISSION_DENIED', 'Bluetooth access was blocked. Open Tallyko over HTTPS and tap the button again.', e);
    }
    if (name === 'NotAllowedError') throw new PrinterError('PERMISSION_DENIED', undefined, e);
    throw new PrinterError('UNAVAILABLE', 'Bluetooth is not available in this browser or is turned off.', e);
  }
  webDevices.set(device.id, device);
  return [{ id: device.id, name: device.name || 'Bluetooth printer', kind: 'web-bluetooth' }];
}

// ---------------------------------------------------------------------------
// Connections (module-level cache)
// ---------------------------------------------------------------------------

interface BleTarget {
  serviceUUID: string;
  charUUID: string;
  withoutResponse: boolean;
  chunk: number;
}
const bleTargets = new Map<string, BleTarget>();
const classicConnected = new Set<string>();
const webTargets = new Map<string, { char: WebBtCharacteristic; withoutResponse: boolean }>();

async function ensureClassic(address: string): Promise<ClassicApi> {
  const classic = loadClassic();
  if (!classic) throw new PrinterError('UNAVAILABLE');
  if (classicConnected.has(address)) {
    const still = await classic.isDeviceConnected(address).catch(() => false);
    if (still) return classic;
    classicConnected.delete(address);
  }
  if (!(await classic.isBluetoothEnabled().catch(() => true))) throw new PrinterError('BLUETOOTH_OFF');
  const attempt = (secure: boolean) =>
    withTimeout(classic.connectToDevice(address, { connectorType: 'rfcomm', delimiter: '', secure }), tuning.connectTimeoutMs);
  try {
    await attempt(true);
  } catch (first) {
    // Some cheap SPP printers only accept insecure RFCOMM sockets.
    try {
      await attempt(false);
    } catch (e) {
      throw new PrinterError(isPrinterError(e) && e.code === 'TIMEOUT' ? 'TIMEOUT' : 'CONNECT_FAILED', undefined, first ?? e);
    }
  }
  classicConnected.add(address);
  return classic;
}

async function printClassic(device: PrinterDevice, bytes: Uint8Array): Promise<void> {
  const address = device.address ?? device.id;
  let classic = await ensureClassic(address);
  const chunks = chunkBytes(bytes, tuning.classicChunkSize);
  let retried = false;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const ok = await withTimeout(classic.writeToDevice(address, bytesToBase64(chunks[i]!), 'base64'), tuning.writeTimeoutMs);
      if (ok === false) throw new PrinterError('WRITE_FAILED');
    } catch (e) {
      if (retried) throw wrap('WRITE_FAILED', e);
      retried = true;
      // Connection dropped (printer slept / out of range): reconnect once, resume from this chunk.
      classicConnected.delete(address);
      await classic.disconnectFromDevice(address).catch(() => undefined);
      classic = await ensureClassic(address);
      i -= 1;
      continue;
    }
    if (chunks.length > 1) await sleep(tuning.classicChunkDelayMs);
  }
}

async function ensureBle(id: string): Promise<{ ble: BleManager; target: BleTarget }> {
  const ble = loadBle();
  if (!ble) throw new PrinterError('UNAVAILABLE');
  const cached = bleTargets.get(id);
  if (cached && (await ble.isDeviceConnected(id).catch(() => false))) return { ble, target: cached };
  bleTargets.delete(id);
  await waitForBlePoweredOn(ble);

  let device: BleDevice;
  try {
    device = await withTimeout(
      ble.connectToDevice(id, { timeout: tuning.connectTimeoutMs, ...(Platform.OS === 'android' ? { requestMTU: 185 } : {}) }),
      tuning.connectTimeoutMs + 2000,
    );
    device = await withTimeout(device.discoverAllServicesAndCharacteristics(), tuning.connectTimeoutMs);
  } catch (e) {
    await ble.cancelDeviceConnection(id).catch(() => undefined);
    throw wrap(isPrinterError(e) ? e.code : 'CONNECT_FAILED', e);
  }

  const services = (await device.services()).sort((a, b) => servicePriority(a.uuid) - servicePriority(b.uuid));
  let found: Characteristic | null = null;
  for (const s of services) {
    const chars = await s.characteristics();
    found =
      chars.find((c) => c.isWritableWithoutResponse) ?? chars.find((c) => c.isWritableWithResponse) ?? null;
    if (found) break;
  }
  if (!found) {
    await ble.cancelDeviceConnection(id).catch(() => undefined);
    throw new PrinterError('NO_WRITABLE_CHARACTERISTIC');
  }
  const mtu = typeof device.mtu === 'number' && device.mtu > 23 ? device.mtu : 23;
  const target: BleTarget = {
    serviceUUID: found.serviceUUID,
    charUUID: found.uuid,
    withoutResponse: found.isWritableWithoutResponse,
    chunk: Math.max(20, Math.min(tuning.bleChunkSize, mtu - 3)),
  };
  bleTargets.set(id, target);
  return { ble, target };
}

async function printBle(device: PrinterDevice, bytes: Uint8Array): Promise<void> {
  let { ble, target } = await ensureBle(device.id);
  let retried = false;
  let offset = 0;
  while (offset < bytes.length) {
    const chunk = bytes.subarray(offset, Math.min(offset + target.chunk, bytes.length));
    const b64 = bytesToBase64(chunk);
    try {
      const write = target.withoutResponse
        ? ble.writeCharacteristicWithoutResponseForDevice(device.id, target.serviceUUID, target.charUUID, b64)
        : ble.writeCharacteristicWithResponseForDevice(device.id, target.serviceUUID, target.charUUID, b64);
      await withTimeout(write, tuning.writeTimeoutMs);
    } catch (e) {
      if (retried) throw wrap('WRITE_FAILED', e);
      retried = true;
      bleTargets.delete(device.id);
      await ble.cancelDeviceConnection(device.id).catch(() => undefined);
      ({ ble, target } = await ensureBle(device.id));
      continue; // resume from the same offset
    }
    offset += chunk.length;
    if (target.withoutResponse && offset < bytes.length) await sleep(tuning.bleChunkDelayMs);
  }
}

async function ensureWeb(id: string) {
  const device = webDevices.get(id);
  if (!device?.gatt) {
    throw new PrinterError('NOT_FOUND', 'Select the Bluetooth printer again (browsers forget it after a reload).');
  }
  const cached = webTargets.get(id);
  if (cached && device.gatt.connected) return cached;
  webTargets.delete(id);
  let server: WebBtServer;
  try {
    server = await withTimeout(device.gatt.connect(), tuning.connectTimeoutMs);
  } catch (e) {
    throw wrap('CONNECT_FAILED', e);
  }
  const services = (await server.getPrimaryServices()).sort((a, b) => servicePriority(a.uuid) - servicePriority(b.uuid));
  for (const s of services) {
    const chars = await s.getCharacteristics();
    const c = chars.find((ch) => ch.properties.writeWithoutResponse) ?? chars.find((ch) => ch.properties.write);
    if (c) {
      const t = { char: c, withoutResponse: !c.properties.write && c.properties.writeWithoutResponse };
      webTargets.set(id, t);
      return t;
    }
  }
  server.disconnect();
  throw new PrinterError('NO_WRITABLE_CHARACTERISTIC');
}

async function printWeb(device: PrinterDevice, bytes: Uint8Array): Promise<void> {
  let target = await ensureWeb(device.id);
  let retried = false;
  let offset = 0;
  while (offset < bytes.length) {
    const chunk = bytes.slice(offset, Math.min(offset + tuning.webChunkSize, bytes.length));
    try {
      const c = target.char;
      const write = target.withoutResponse
        ? (c.writeValueWithoutResponse ?? c.writeValue)!.call(c, chunk)
        : (c.writeValueWithResponse ?? c.writeValue)!.call(c, chunk);
      await withTimeout(write, tuning.writeTimeoutMs);
    } catch (e) {
      if (retried) throw wrap('WRITE_FAILED', e);
      retried = true;
      webTargets.delete(device.id);
      target = await ensureWeb(device.id);
      continue;
    }
    offset += chunk.length;
    if (target.withoutResponse && offset < bytes.length) await sleep(tuning.bleChunkDelayMs);
  }
}

// ---------------------------------------------------------------------------
// Public printing API
// ---------------------------------------------------------------------------

/** Sends raw ESC/POS bytes to a Bluetooth printer. Queued; throws PrinterError. */
export function printBytes(device: PrinterDevice, bytes: Uint8Array): Promise<void> {
  return enqueuePrintJob(async () => {
    if (bytes.length === 0) return;
    try {
      switch (device.kind) {
        case 'bt-classic':
          return await printClassic(device, bytes);
        case 'ble':
          return await printBle(device, bytes);
        case 'web-bluetooth':
          return await printWeb(device, bytes);
        default:
          throw new PrinterError('UNSUPPORTED', 'The system printer prints HTML receipts, not raw printer commands.');
      }
    } catch (e) {
      throw wrap('PRINT_FAILED', e);
    }
  });
}

export interface PrintHtmlOptions {
  /** Paper width for native print (sets page width in points). */
  paperWidth?: PaperWidth;
}

/** Prints an HTML document via the OS print dialog (expo-print on native, hidden iframe on web). Queued. */
export function printHtml(html: string, opts: PrintHtmlOptions = {}): Promise<void> {
  return enqueuePrintJob(async () => {
    if (Platform.OS === 'web') return printHtmlWeb(html);
    try {
      const width = opts.paperWidth ? Math.round((opts.paperWidth / 25.4) * 72) : undefined;
      await Print.printAsync(width ? { html, width } : { html });
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '');
      if (/cancel/i.test(msg)) throw new PrinterError('CANCELLED', 'Printing was cancelled.', e);
      throw new PrinterError('PRINT_FAILED', undefined, e);
    }
  });
}

function printHtmlWeb(html: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new PrinterError('UNSUPPORTED', 'Printing is not available in this environment.'));
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    let settled = false;
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      iframe.remove();
    };
    const loadTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      remove();
      reject(new PrinterError('TIMEOUT', 'The receipt could not be prepared for printing.'));
    }, 15000);

    iframe.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      const win = iframe.contentWindow;
      if (!win) {
        remove();
        reject(new PrinterError('PRINT_FAILED'));
        return;
      }
      // Remove after the dialog closes (print() blocks in Chrome, not in Safari/Firefox).
      let safety: ReturnType<typeof setTimeout> | undefined;
      win.addEventListener('afterprint', () => {
        if (safety) clearTimeout(safety);
        setTimeout(remove, 500);
      });
      setTimeout(() => {
        try {
          win.focus();
          win.print();
          resolve();
        } catch (e) {
          remove();
          reject(new PrinterError('PRINT_FAILED', undefined, e));
          return;
        }
        if (!removed) safety = setTimeout(remove, 60000); // safety net if afterprint never fires
      }, 50);
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

/** Prints a receipt: ESC/POS for Bluetooth printers, HTML for the system printer (or when `device` is null). */
export function printReceipt(
  device: PrinterDevice | null,
  data: ReceiptData,
  width: PaperWidth,
  opts: EscPosReceiptOptions = {},
): Promise<void> {
  if (!device || device.kind === 'system') return printHtml(buildReceiptHtml(data, width), { paperWidth: width });
  return printBytes(device, buildReceiptEscPos(data, width, opts));
}

/** Prints a KOT: ESC/POS for Bluetooth printers, HTML for the system printer (or when `device` is null). */
export function printKot(device: PrinterDevice | null, data: KotData, width: PaperWidth): Promise<void> {
  if (!device || device.kind === 'system') return printHtml(buildKotHtml(data, width), { paperWidth: width });
  return printBytes(device, buildKotEscPos(data, width));
}

/** Drops the cached connection to a printer (e.g. when the user picks another printer). */
export async function disconnectPrinter(device: PrinterDevice): Promise<void> {
  try {
    if (device.kind === 'bt-classic') {
      const address = device.address ?? device.id;
      classicConnected.delete(address);
      await loadClassic()?.disconnectFromDevice(address);
    } else if (device.kind === 'ble') {
      bleTargets.delete(device.id);
      await loadBle()?.cancelDeviceConnection(device.id);
    } else if (device.kind === 'web-bluetooth') {
      webTargets.delete(device.id);
      webDevices.get(device.id)?.gatt?.disconnect();
    }
  } catch {
    // already disconnected
  }
}

/** Test helper: resets module-level caches. */
export function __resetPrinterStateForTests(): void {
  classicApi = undefined;
  bleManager = undefined;
  bleTargets.clear();
  classicConnected.clear();
  webTargets.clear();
  webDevices.clear();
  queue = Promise.resolve();
}
