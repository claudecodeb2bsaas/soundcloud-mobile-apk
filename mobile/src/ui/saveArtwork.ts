import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { Alert } from 'react-native';
import { artwork } from '../player/format';

/** Скачивает обложку или аватар в 500x500 и кладёт в галерею (Pictures). Без url ничего не делает */
export async function saveArtwork(url: string | null | undefined): Promise<void> {
  const src = artwork(url, 't500x500');
  if (!src) return;
  let file: File | null = null;
  try {
    if (!(await requestPermissionsAsync(true, ['photo'])).granted) return void Alert.alert('Нет доступа к галерее');
    file = await File.downloadFileAsync(src, new File(Paths.cache, `art-${Date.now()}.${/\.png(\?|$)/.test(src) ? 'png' : 'jpg'}`));
    await Asset.create(file.uri);
    Alert.alert('Сохранено в галерею');
  } catch {
    Alert.alert('Не удалось скачать картинку');
  } finally {
    try { file?.delete(); } catch { /* кэш очистится сам */ }
  }
}
