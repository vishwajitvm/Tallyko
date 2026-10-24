/**
 * Menu photos: pick (camera / library), shrink to ≤2000 px JPEG for a fast upload, and pack into
 * the multipart form expected by POST /ai/menu/extract (field `files`, 1–5 images, ≤10 MB each).
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { localKey } from '../utils';

export const MAX_PHOTOS = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SIDE = 2000;
const QUALITY = 0.85;
const ACCEPTED = /^image\/(jpe?g|png|webp|heic|heif)$/i;

export interface MenuPhoto {
  key: string;
  /** What we upload (resized JPEG when possible, the original otherwise). */
  uri: string;
  /** For the thumbnail. */
  previewUri: string;
  name: string;
  type: string;
  width: number;
  height: number;
  size: number | null;
  resized: boolean;
  /** Web only: original File when we could not re-encode (e.g. HEIC in Chrome). */
  file?: Blob;
  error?: string;
}

export type PickSource = 'camera' | 'library';

export class PickError extends Error {}

export async function pickPhotos(source: PickSource, remaining: number): Promise<ImagePicker.ImagePickerAsset[]> {
  if (remaining <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PickError(perm.canAskAgain ? 'Camera permission is needed to photograph the menu.' : 'Camera access is turned off for Tallyko. Turn it on in your phone settings, or choose photos from the gallery.');
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    return r.canceled ? [] : r.assets;
  }
  // The system photo picker (Android 13+ / iOS 14+) needs no library permission.
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    quality: 1,
    exif: false,
    orderedSelection: true,
  });
  return r.canceled ? [] : r.assets.slice(0, remaining);
}

/** Resize + re-encode; falls back to the original file if the platform can't decode it. */
export async function preparePhoto(asset: ImagePicker.ImagePickerAsset, index: number): Promise<MenuPhoto> {
  const base = {
    key: localKey('p'),
    previewUri: asset.uri,
    width: asset.width,
    height: asset.height,
  };
  const mime = (asset.mimeType || guessMime(asset.fileName || asset.uri)).toLowerCase();
  try {
    let ref = await ImageManipulator.manipulate(asset.uri).renderAsync();
    const long = Math.max(ref.width, ref.height);
    if (long > MAX_SIDE) {
      ref = await ImageManipulator.manipulate(ref)
        .resize(ref.width >= ref.height ? { width: MAX_SIDE } : { height: MAX_SIDE })
        .renderAsync();
    }
    const saved = await ref.saveAsync({ compress: QUALITY, format: SaveFormat.JPEG });
    let size: number | null = null;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(saved.uri)).blob();
      size = blob.size;
      return { ...base, uri: saved.uri, previewUri: saved.uri, name: `menu-${index + 1}.jpg`, type: 'image/jpeg', width: saved.width, height: saved.height, size, resized: true, file: blob };
    }
    return { ...base, uri: saved.uri, previewUri: saved.uri, name: `menu-${index + 1}.jpg`, type: 'image/jpeg', width: saved.width, height: saved.height, size, resized: true };
  } catch {
    // Unreadable here (e.g. HEIC on desktop Chrome) — the server can still decode it
    const size = asset.fileSize ?? (asset.file ? asset.file.size : null);
    const ext = extFor(mime);
    const photo: MenuPhoto = {
      ...base,
      uri: asset.uri,
      name: asset.fileName || `menu-${index + 1}.${ext}`,
      type: ACCEPTED.test(mime) ? mime : 'image/jpeg',
      size,
      resized: false,
      file: asset.file,
    };
    if (mime && !ACCEPTED.test(mime) && mime !== 'application/octet-stream') {
      photo.error = 'This file type is not supported. Use JPEG, PNG, WEBP or HEIC photos.';
    } else if (!/hei[cf]/.test(mime) && mime !== 'application/octet-stream' && mime !== '') {
      // JPEG/PNG/WEBP decode everywhere, so a failure means the file is damaged or not really an image
      photo.error = 'This photo could not be opened — it may be damaged. Try another one.';
    } else if (size !== null && size > MAX_BYTES) {
      photo.error = `This photo is ${(size / 1024 / 1024).toFixed(1)} MB — the limit is 10 MB. Take a new photo or pick a smaller one.`;
    }
    return photo;
  }
}

export async function buildMenuForm(photos: MenuPhoto[]): Promise<FormData> {
  const form = new FormData();
  for (const p of photos) {
    if (Platform.OS === 'web') {
      const blob = p.file ?? (await (await fetch(p.uri)).blob());
      form.append('files', blob, p.name);
    } else {
      form.append('files', { uri: p.uri, name: p.name, type: p.type } as any);
    }
  }
  return form;
}

export function releasePhoto(p: MenuPhoto) {
  if (Platform.OS === 'web' && p.uri.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(p.uri);
    } catch {
      // ignore
    }
  }
}

function guessMime(name: string): string {
  const n = name.toLowerCase();
  if (/\.jpe?g($|\?)/.test(n)) return 'image/jpeg';
  if (/\.png($|\?)/.test(n)) return 'image/png';
  if (/\.webp($|\?)/.test(n)) return 'image/webp';
  if (/\.hei[cf]($|\?)/.test(n)) return 'image/heic';
  if (n.startsWith('data:image/')) return n.slice(5, n.indexOf(';'));
  return '';
}

function extFor(mime: string): string {
  if (/png/.test(mime)) return 'png';
  if (/webp/.test(mime)) return 'webp';
  if (/hei/.test(mime)) return 'heic';
  return 'jpg';
}
