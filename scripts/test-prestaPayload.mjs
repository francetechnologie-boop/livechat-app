// Minimal test for buildPrestaImportPayloadFromPrepared
import { buildPrestaImportPayloadFromPrepared } from '../modules/automation-suite/frontend/utils/prestaPayload.js';

function assert(cond, msg) {
  if (!cond) { throw new Error('Assertion failed: ' + msg); }
}

function run() {
  const prepared = {
    item: {
      title: 'Gettacarte autoestinguente 25xh 60 cm',
      url: 'https://stilcasashop.com/products/gettacarte-autoestinguente-25xh-60-cm',
      meta: { title: 'Gettacarte autoestinguente 25xh 60 cm', og_image: 'https://example.com/cover.jpg' },
      product_raw: {
        default_variant_id: 42630498222336,
        default_variant_sku: '545_N',
        images_local: [
          { download_url: '/api/grabbings/jerome/doc/img-0.jpg' },
          { download_url: '/api/grabbings/jerome/doc/img-1.jpg' }
        ]
      },
      mapped: {
        sku: '545_N',
        name: 'Gettacarte autoestinguente 25xh 60 cm',
        description: 'desc',
        price: 5474,
        currency: 'EUR',
        images: [ { url: 'https://example.com/remote.jpg' } ],
        variants: [
          { id: 42630498222336, sku: '545_N', title: 'NERO', price: 5474 },
          { id: 42630498255104, sku: '545_G', title: 'GRIGIO', price: 5474 },
          { id: 42630498320640, sku: '545_AS', title: 'ACCIAIO SATINATO', price: 7735 }
        ]
      }
    }
  };

  const data = buildPrestaImportPayloadFromPrepared(prepared, prepared.item.url);
  // Basic shape
  assert(data && data.page && data.meta && data.product, 'payload shape');
  assert(Array.isArray(data.product.variants) && data.product.variants.length === 3, 'variants copied');
  // Defaults propagated
  assert(data.product.default_variant_id === 42630498222336, 'default_variant_id propagated');
  assert(data.product.default_variant_sku === '545_N', 'default_variant_sku propagated');
  // Images prefer local download urls
  assert(Array.isArray(data.product.images) && data.product.images[0] === '/api/grabbings/jerome/doc/img-0.jpg', 'images use local first');
}

try {
  run();
  console.log('OK: prestaPayload helper tests passed');
  process.exit(0);
} catch (e) {
  console.error('FAIL:', e?.message || e);
  process.exit(1);
}

