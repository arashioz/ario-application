import { useEffect, useState } from 'react';
import { IonPage, IonContent, IonSpinner } from '@ionic/react';
import { callOutline, copyOutline } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';

interface TierPrice {
  label: string;
  minKg?: number;
  pricePerKg: number;
  pricePerPackage: number;
}

interface CatalogProduct {
  id: string;
  name: string;
  imageUrl?: string | null;
  kgPerPackage: number;
  minQty: number;
  note?: string | null;
  prices?: {
    retail: TierPrice;
    supermarket: TierPrice;
    wholesale: TierPrice;
  };
  pricePerKg?: number;
  pricePerPackage?: number;
}

interface CatalogData {
  enabled: boolean;
  shopName: string;
  brandName?: string;
  brandTagline?: string | null;
  brandPrimaryColor?: string;
  brandLogoUrl?: string | null;
  title: string;
  phone?: string | null;
  note?: string | null;
  tiers?: { supermarketMinKg: number; wholesaleMinKg: number };
  products: CatalogProduct[];
}

function formatToman(n: number) {
  return `${Math.round(n || 0).toLocaleString('fa-IR')} ت`;
}

const PublicCatalog: React.FC = () => {
  const [data, setData] = useState<CatalogData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetch('/api/public/catalog')
      .then(async (r) => {
        if (!r.ok) throw new Error('کاتالوگ لود نشد');
        return r.json() as Promise<CatalogData>;
      })
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'خطا'))
      .finally(() => setLoading(false));
  }, []);

  const accent = data?.brandPrimaryColor || '#0d9488';
  const brand = data?.brandName || data?.shopName || 'آریو';
  const supermarketKg = data?.tiers?.supermarketMinKg || 500;
  const wholesaleKg = data?.tiers?.wholesaleMinKg || 2000;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <IonPage className="catalog-page">
      <IonContent fullscreen scrollY className="catalog-content">
        <div
          className="catalog-shell"
          style={{ ['--cat-accent' as string]: accent }}
        >
          {loading && (
            <div className="catalog-loading">
              <IonSpinner name="crescent" color="light" />
            </div>
          )}
          {error && <div className="catalog-empty">{error}</div>}
          {data && !data.enabled && (
            <div className="catalog-empty">کاتالوگ فعلاً غیرفعال است</div>
          )}

          {data?.enabled && (
            <>
              <header className="catalog-hero">
                <div className="catalog-hero-glow" />
                <div className="catalog-hero-inner">
                  {data.brandLogoUrl ? (
                    <img src={data.brandLogoUrl} alt={brand} className="catalog-logo" />
                  ) : (
                    <div className="catalog-logo-fallback">{brand.slice(0, 1)}</div>
                  )}
                  <h1 className="catalog-brand">{brand}</h1>
                  {data.brandTagline && (
                    <p className="catalog-tagline">{data.brandTagline}</p>
                  )}
                  <p className="catalog-title">{data.title}</p>
                  {data.note && <p className="catalog-note">{data.note}</p>}

                  <div className="catalog-tier-legend">
                    <span className="tier-chip retail">تکی</span>
                    <span className="tier-chip super">
                      ≥ {supermarketKg.toLocaleString('fa-IR')} کیلو · سوپر
                    </span>
                    <span className="tier-chip whole">
                      ≥ {(wholesaleKg / 1000).toLocaleString('fa-IR')} تن · عمده
                    </span>
                  </div>

                  <div className="catalog-actions">
                    {data.phone && (
                      <a className="catalog-btn primary" href={`tel:${data.phone}`}>
                        <IonIcon icon={callOutline} />
                        تماس
                      </a>
                    )}
                    <button type="button" className="catalog-btn ghost" onClick={() => void copyLink()}>
                      <IonIcon icon={copyOutline} />
                      {copied ? 'کپی شد' : 'کپی لینک'}
                    </button>
                  </div>
                </div>
              </header>

              {data.products.length === 0 && (
                <div className="catalog-empty">هنوز محصولی در کاتالوگ نیست</div>
              )}

              <div className="catalog-grid">
                {data.products.map((p, i) => {
                  const prices = p.prices;
                  return (
                    <article
                      key={p.id}
                      className="catalog-card-v2"
                      style={{ animationDelay: `${Math.min(i, 12) * 60}ms` }}
                    >
                      <div className="catalog-card-media">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} loading="lazy" />
                        ) : (
                          <div className="catalog-card-ph">{p.name.slice(0, 1)}</div>
                        )}
                        <span className="catalog-pack-badge">{p.kgPerPackage}kg</span>
                      </div>
                      <div className="catalog-card-body">
                        <h2>{p.name}</h2>
                        <p className="catalog-min">
                          حداقل خرید: {p.minQty.toLocaleString('fa-IR')} بسته
                        </p>
                        {p.note && <p className="catalog-item-note">{p.note}</p>}

                        <div className="catalog-price-tiers">
                          <div className="cpt retail">
                            <span className="cpt-label">تکی</span>
                            <strong>
                              {formatToman(prices?.retail.pricePerKg ?? p.pricePerKg ?? 0)}
                            </strong>
                            <small>/کیلو</small>
                          </div>
                          <div className="cpt super">
                            <span className="cpt-label">
                              ≥ {supermarketKg.toLocaleString('fa-IR')} کیلو
                            </span>
                            <strong>
                              {formatToman(prices?.supermarket.pricePerKg ?? 0)}
                            </strong>
                            <small>سوپرمارکت</small>
                          </div>
                          <div className="cpt whole">
                            <span className="cpt-label">
                              ≥ {(wholesaleKg / 1000).toLocaleString('fa-IR')} تن
                            </span>
                            <strong>
                              {formatToman(prices?.wholesale.pricePerKg ?? 0)}
                            </strong>
                            <small>عمده</small>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              <footer className="catalog-footer">
                <span>{brand}</span>
                {data.phone && <span>{data.phone}</span>}
              </footer>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default PublicCatalog;
