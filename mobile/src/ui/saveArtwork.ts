import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { artwork } from '../player/format';
import { toast } from './feedback';

/** Скачивает обложку или аватар в 500x500 и кладёт в галерею (Pictures). Без url ничего не делает */
export async function saveArtwork(url: string | null | undefined): Promise<void> {
  const src = artwork(url, 't500x500');
  if (!src) return;
  let file: File | null = null;
  try {
    if (!(await requestPermissionsAsync(true, ['photo'])).granted) return void toast('Нет доступа к галерее', 'download');
    file = await File.downloadFileAsync(src, new File(Paths.cache, `art-${Date.now()}.${/\.png(\?|$)/.test(src) ? 'png' : 'jpg'}`));
    await Asset.create(file.uri);
    toast('Сохранено в галерею', 'check');
  } catch {
    toast('Не удалось скачать картинку', 'download');
  } finally {
    try { file?.delete(); } catch { /* кэш очистится сам */ }
  }
}
