import Lizard from '@loggerlizard/lizard';

const liz = new Lizard('llz_pub_c84b0bfc9e484a808313987ae8cf20a4', {
  autoTrack: true,
  debug: false
});

let isFirstLoad = true;
document.addEventListener('astro:page-load', () => {
  if (isFirstLoad) {
    isFirstLoad = false;
    return;
  }
  liz.log('page_view');
});
