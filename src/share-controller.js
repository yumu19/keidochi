import { createShareSvg, createShareImage, canShareImage, imageShareData } from './share-image.js';
import { createRecordLink } from './shared-records.js';
import { shareUrl } from './model.js';

export function createShareController({ document, getRecords, fullViewBox, toast, isViewer = false, beforeShare = () => true, canShare = () => true }) {
  const window = document.defaultView;
  const $ = selector => document.querySelector(selector);
  let shareFile = null;
  let sharePreviewUrl = null;
  let shareIntentUrl = '';
  let shareRecordUrl = '';
  let shareGeneration = 0;

  function clearShareImage() {
    shareFile = null;
    if (sharePreviewUrl) window.URL.revokeObjectURL(sharePreviewUrl);
    sharePreviewUrl = null;
    $('#share-preview').removeAttribute('src');
    $('#share-preview').hidden = true;
  }

  async function prepareShareImage() {
    const generation = ++shareGeneration;
    clearShareImage();
    $('#share-status').textContent = isViewer ? '表示中の地図から画像を作成しています…' : '入力済みの地図から画像を作成しています…';
    $('#share-error').hidden = true;
    $('#share-retry').hidden = true;
    $('#share-native').hidden = true;
    $('#share-download').disabled = true;
    $('#share-instructions').hidden = true;
    const snapshot = { ...getRecords() };
    shareIntentUrl = shareUrl(snapshot, window.location.href);
    shareRecordUrl = createRecordLink(snapshot, window.location.href);
    $('#share-link-field').hidden = true;
    $('#share-link-url').value = shareRecordUrl;
    try {
      const svg = createShareSvg($('#hokkaido-map'), snapshot, fullViewBox, { shared: isViewer });
      const file = await createShareImage(svg);
      if (generation !== shareGeneration || !$('#share-dialog').open) return;
      shareFile = file;
      sharePreviewUrl = window.URL.createObjectURL(file);
      $('#share-preview').src = sharePreviewUrl;
      $('#share-preview').hidden = false;
      $('#share-download').disabled = false;
      const nativeSharing = canShareImage(file, window.navigator);
      $('#share-native').hidden = !nativeSharing;
      $('#share-native').disabled = false;
      $('#share-status').textContent = '記録を反映した地図画像ができました。メモは含まれません。';
      $('#share-instructions').textContent = nativeSharing
        ? '「画像付きで共有」から共有先にXを選んでください。Xが表示されない場合は、画像を保存して投稿画面で添付できます。'
        : '①画像を保存 → ②Xの投稿画面を開く → ③保存した画像を添付してください。投稿画面に画像は自動添付されません。';
      $('#share-instructions').hidden = false;
    } catch {
      if (generation !== shareGeneration || !$('#share-dialog').open) return;
      $('#share-status').textContent = '地図画像を作成できませんでした。';
      $('#share-error').textContent = 'もう一度お試しください。Xの投稿画面を開いて、テキストのみで共有することもできます。';
      $('#share-error').hidden = false;
      $('#share-retry').hidden = false;
    }
  }

  function share() {
    if (!canShare() || !beforeShare()) return;
    if ($('#share-dialog').open) return;
    $('#share-dialog').showModal();
    void prepareShareImage();
  }
  $('#share-top').addEventListener('click', share);
  $('#share-bottom').addEventListener('click', share);
  $('#share-copy-link').addEventListener('click', async () => {
    if (!shareRecordUrl) return;
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await window.navigator.clipboard.writeText(shareRecordUrl);
      toast('記録付きリンクをコピーしました');
    } catch {
      $('#share-link-field').hidden = false;
      $('#share-link-url').focus();
      $('#share-link-url').select();
      toast('リンクを選択しました。コピーして共有してください。');
    }
  });
  $('#share-retry').addEventListener('click', () => { void prepareShareImage(); });
  $('#share-dialog').addEventListener('close', () => {
    shareGeneration++;
    clearShareImage();
  });
  $('#share-download').addEventListener('click', () => {
    if (!shareFile || !sharePreviewUrl) return;
    const link = document.createElement('a');
    link.href = sharePreviewUrl;
    link.download = shareFile.name;
    link.click();
  });
  $('#share-x').addEventListener('click', () => {
    if (!shareIntentUrl) return;
    const link = document.createElement('a');
    link.href = shareIntentUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.click();
  });
  $('#share-native').addEventListener('click', async () => {
    if (!shareFile) return;
    const generation = shareGeneration;
    $('#share-native').disabled = true;
    try {
      // The image is already ready: invoke sharing directly from this user gesture.
      await window.navigator.share(imageShareData(shareFile, shareIntentUrl));
      if (generation === shareGeneration) {
        $('#share-dialog').close();
        toast('共有先に地図画像を渡しました');
      }
    } catch (error) {
      if (generation !== shareGeneration || error.name === 'AbortError') return;
      $('#share-error').textContent = '画像付きで共有できませんでした。画像を保存し、Xの投稿画面で添付してください。';
      $('#share-error').hidden = false;
    } finally {
      if (generation === shareGeneration) $('#share-native').disabled = false;
    }
  });

}
