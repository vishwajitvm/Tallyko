/// <reference types="jest" />
/// <reference types="node" />
import { NativeModules, Platform } from 'react-native';

jest.mock('expo-print', () => ({ printAsync: jest.fn(() => Promise.resolve()) }));

// --- BLE mock -------------------------------------------------------------
const bleWrites: { id: string; data: number[] }[] = [];
const bleState = { failNextWrite: false, connected: new Set<string>() };
const mockBleManager = {
  state: jest.fn(async () => 'PoweredOn'),
  onStateChange: jest.fn(() => ({ remove: jest.fn() })),
  startDeviceScan: jest.fn(async (_u: unknown, _o: unknown, cb: (e: unknown, d: unknown) => void) => {
    cb(null, { id: 'AA:BB', name: 'MTP-II', localName: null });
    cb(null, { id: 'CC:DD', name: null, localName: null });
  }),
  stopDeviceScan: jest.fn(async () => undefined),
  isDeviceConnected: jest.fn(async (id: string) => bleState.connected.has(id)),
  cancelDeviceConnection: jest.fn(async (id: string) => {
    bleState.connected.delete(id);
  }),
  connectToDevice: jest.fn(async (id: string) => {
    bleState.connected.add(id);
    const device = {
      id,
      mtu: 185,
      discoverAllServicesAndCharacteristics: async () => device,
      services: async () => [
        { uuid: '00001800-0000-1000-8000-00805f9b34fb', characteristics: async () => [] },
        {
          uuid: '000018f0-0000-1000-8000-00805f9b34fb',
          characteristics: async () => [
            {
              uuid: '00002af1-0000-1000-8000-00805f9b34fb',
              serviceUUID: '000018f0-0000-1000-8000-00805f9b34fb',
              isWritableWithoutResponse: true,
              isWritableWithResponse: true,
            },
          ],
        },
      ],
    };
    return device;
  }),
  writeCharacteristicWithoutResponseForDevice: jest.fn(async (id: string, _s: string, _c: string, b64: string) => {
    if (bleState.failNextWrite) {
      bleState.failNextWrite = false;
      throw new Error('disconnected');
    }
    await new Promise((r) => setTimeout(r, 1));
    bleWrites.push({ id, data: Array.from(Buffer.from(b64, 'base64')) });
  }),
  writeCharacteristicWithResponseForDevice: jest.fn(),
};
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn(() => mockBleManager) }));

// --- Bluetooth Classic mock ------------------------------------------------
const classicWrites: number[][] = [];
const classicState = { failNextWrite: false, connected: new Set<string>() };
const mockClassic = {
  isBluetoothEnabled: jest.fn(async () => true),
  requestBluetoothEnabled: jest.fn(async () => true),
  getBondedDevices: jest.fn(async () => [{ address: '11:22', name: 'PT-210' }]),
  isDeviceConnected: jest.fn(async (a: string) => classicState.connected.has(a)),
  connectToDevice: jest.fn(async (a: string) => {
    classicState.connected.add(a);
    return {};
  }),
  disconnectFromDevice: jest.fn(async (a: string) => classicState.connected.delete(a)),
  writeToDevice: jest.fn(async (_a: string, b64: string) => {
    if (classicState.failNextWrite) {
      classicState.failNextWrite = false;
      classicState.connected.clear();
      throw new Error('Broken pipe');
    }
    classicWrites.push(Array.from(Buffer.from(b64, 'base64')));
    return true;
  }),
};
jest.mock('react-native-bluetooth-classic', () => ({ __esModule: true, default: mockClassic }));

// eslint-disable-next-line import/first
import * as Print from 'expo-print';
// eslint-disable-next-line import/first
import {
  __resetPrinterStateForTests,
  bytesToBase64,
  chunkBytes,
  enqueuePrintJob,
  getCapabilities,
  printBytes,
  printHtml,
  PrinterError,
  scanPrinters,
  setPrintTuning,
  SYSTEM_PRINTER,
} from '../printers';

const originalOS = Platform.OS;
function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}
const nm = NativeModules as Record<string, unknown>;

beforeEach(() => {
  __resetPrinterStateForTests();
  bleWrites.length = 0;
  classicWrites.length = 0;
  bleState.connected.clear();
  classicState.connected.clear();
  delete nm.BlePlx;
  delete nm.RNBluetoothClassic;
  setPrintTuning({ bleChunkDelayMs: 0, classicChunkDelayMs: 0 });
  jest.clearAllMocks();
});
afterAll(() => setOS(originalOS));

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 256);

describe('helpers', () => {
  it('base64-encodes like Buffer', () => {
    for (let n = 0; n < 10; n++) {
      const b = bytes(n * 7 + (n % 3));
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });

  it('chunks bytes', () => {
    const chunks = chunkBytes(bytes(500), 180);
    expect(chunks.map((c) => c.length)).toEqual([180, 180, 140]);
  });

  it('runs queued jobs sequentially even when one fails', async () => {
    const log: string[] = [];
    const job = (name: string, ms: number, fail = false) => () =>
      new Promise<void>((resolve, reject) => {
        log.push(`start ${name}`);
        setTimeout(() => {
          log.push(`end ${name}`);
          if (fail) reject(new Error(name));
          else resolve();
        }, ms);
      });
    const a = enqueuePrintJob(job('a', 20, true));
    const b = enqueuePrintJob(job('b', 1));
    await expect(a).rejects.toThrow('a');
    await b;
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('without native modules (Expo Go / web without Web Bluetooth)', () => {
  it('reports capabilities and fails gracefully', async () => {
    setOS('android');
    expect(getCapabilities()).toEqual({ btClassic: false, ble: false, webBluetooth: false, system: true });
    await expect(scanPrinters(100)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(printBytes({ id: 'x', name: 'x', kind: 'ble' }, bytes(10))).rejects.toBeInstanceOf(PrinterError);
  });

  it('rejects raw bytes for the system printer', async () => {
    await expect(printBytes(SYSTEM_PRINTER, bytes(5))).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });

  it('web without navigator.bluetooth reports unsupported', async () => {
    setOS('web');
    expect(getCapabilities().webBluetooth).toBe(false);
    await expect(scanPrinters()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  });
});

describe('BLE printing', () => {
  beforeEach(() => {
    setOS('ios');
    nm.BlePlx = {};
  });

  it('scans named BLE devices', async () => {
    const list = await scanPrinters(1000);
    expect(list).toEqual([{ id: 'AA:BB', name: 'MTP-II', kind: 'ble' }]);
    expect(mockBleManager.stopDeviceScan).toHaveBeenCalled();
  });

  it('writes in ≤180-byte chunks to the printer service and reassembles exactly', async () => {
    const data = bytes(500);
    await printBytes({ id: 'AA:BB', name: 'MTP-II', kind: 'ble' }, data);
    expect(bleWrites.map((w) => w.data.length)).toEqual([180, 180, 140]);
    expect(bleWrites.flatMap((w) => w.data)).toEqual(Array.from(data));
    expect(mockBleManager.writeCharacteristicWithoutResponseForDevice.mock.calls[0]!.slice(1, 3)).toEqual([
      '000018f0-0000-1000-8000-00805f9b34fb',
      '00002af1-0000-1000-8000-00805f9b34fb',
    ]);
    // connection is cached for the next job
    await printBytes({ id: 'AA:BB', name: 'MTP-II', kind: 'ble' }, bytes(10));
    expect(mockBleManager.connectToDevice).toHaveBeenCalledTimes(1);
  });

  it('reconnects once and resumes after a failed write', async () => {
    bleState.failNextWrite = true;
    const data = bytes(300);
    await printBytes({ id: 'AA:BB', name: 'MTP-II', kind: 'ble' }, data);
    expect(mockBleManager.connectToDevice).toHaveBeenCalledTimes(2);
    expect(bleWrites.flatMap((w) => w.data)).toEqual(Array.from(data));
  });

  it('does not interleave concurrent jobs', async () => {
    const dev = { id: 'AA:BB', name: 'MTP-II', kind: 'ble' as const };
    const one = new Uint8Array(400).fill(1);
    const two = new Uint8Array(400).fill(2);
    await Promise.all([printBytes(dev, one), printBytes(dev, two)]);
    const flat = bleWrites.flatMap((w) => w.data);
    expect(flat).toEqual([...one, ...two]);
  });
});

describe('Bluetooth Classic printing (Android)', () => {
  beforeEach(() => {
    setOS('android');
    nm.RNBluetoothClassic = {};
  });

  it('lists bonded devices', async () => {
    const perms = jest.spyOn(require('react-native').PermissionsAndroid, 'requestMultiple').mockResolvedValue({
      'android.permission.BLUETOOTH_SCAN': 'granted',
      'android.permission.BLUETOOTH_CONNECT': 'granted',
    });
    const req = jest.spyOn(require('react-native').PermissionsAndroid, 'request').mockResolvedValue('granted');
    const list = await scanPrinters(100);
    expect(list).toEqual([{ id: '11:22', address: '11:22', name: 'PT-210', kind: 'bt-classic' }]);
    perms.mockRestore();
    req.mockRestore();
  });

  it('writes base64 data and reconnects on a broken connection', async () => {
    const dev = { id: '11:22', address: '11:22', name: 'PT-210', kind: 'bt-classic' as const };
    await printBytes(dev, bytes(100));
    expect(mockClassic.writeToDevice).toHaveBeenCalledWith('11:22', expect.any(String), 'base64');
    classicState.failNextWrite = true;
    await printBytes(dev, bytes(50));
    expect(mockClassic.connectToDevice.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(classicWrites.flat()).toEqual([...bytes(100), ...bytes(50)]);
  });

  it('maps connection failures to a friendly error', async () => {
    mockClassic.connectToDevice.mockRejectedValueOnce(new Error('read failed')).mockRejectedValueOnce(new Error('read failed'));
    await expect(printBytes({ id: '99:99', name: 'x', kind: 'bt-classic' }, bytes(5))).rejects.toMatchObject({
      code: 'CONNECT_FAILED',
      message: expect.stringContaining('Could not connect'),
    });
  });
});

describe('printHtml', () => {
  it('uses expo-print on native with the paper width in points', async () => {
    setOS('ios');
    await printHtml('<p>hi</p>', { paperWidth: 58 });
    expect(Print.printAsync).toHaveBeenCalledWith({ html: '<p>hi</p>', width: 164 });
  });

  it('prints via a hidden iframe on web', async () => {
    setOS('web');
    const print = jest.fn();
    const focus = jest.fn();
    let afterprint: (() => void) | undefined;
    const addEventListener = jest.fn((_: string, fn: () => void) => {
      afterprint = fn;
    });
    print.mockImplementation(() => setTimeout(() => afterprint?.(), 0));
    const iframe: Record<string, unknown> = {
      style: {},
      setAttribute: jest.fn(),
      remove: jest.fn(),
      contentWindow: { print, focus, addEventListener },
    };
    const g = globalThis as Record<string, unknown>;
    const prevDoc = g.document;
    g.document = {
      createElement: jest.fn(() => iframe),
      body: {
        appendChild: jest.fn(() => {
          setTimeout(() => (iframe.onload as () => void)(), 0);
        }),
      },
    };
    try {
      await printHtml('<html><body>receipt</body></html>');
      expect(iframe.srcdoc).toBe('<html><body>receipt</body></html>');
      expect(print).toHaveBeenCalled();
      expect(Print.printAsync).not.toHaveBeenCalled();
      await new Promise((r) => setTimeout(r, 600));
      expect(iframe.remove).toHaveBeenCalled();
    } finally {
      g.document = prevDoc;
    }
  });
});
