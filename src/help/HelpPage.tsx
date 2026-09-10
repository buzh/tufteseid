import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import LanguageSwitcher from '../languageswitcher/LanguageSwitcher';
import { ContentBlock, Tip, unwrapJsonModule } from '../types/tips';
import { Icon, type MaterialSymbol, Section } from '../ui';
import styles from './HelpPage.module.css';

const categories: {
  id: string;
  icon: MaterialSymbol;
}[] = [
  { id: 'propertyInfo', icon: 'house' },
  { id: 'map', icon: 'map' },
  { id: 'drawing', icon: 'edit' },
  { id: 'search', icon: 'search' },
  { id: 'sharing', icon: 'share' },
];

const ExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: string;
}) => (
  <a className={styles.link} href={href} target="_blank" rel="noreferrer">
    {children}
    <Icon icon="open_in_new" size={14} />
  </a>
);

const TipsAndTricksContent = ({ content }: { content: ContentBlock[] }) => (
  <>
    {content.map((block, i) => {
      if (block.type === 'text') {
        return (
          <p key={i} className={styles.tipText}>
            {block.text}
          </p>
        );
      }
      if (block.type === 'list') {
        return (
          <ul key={i} className={styles.tipList}>
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        );
      }
      if (block.type === 'link') {
        return (
          <p key={i} className={styles.tipText}>
            <ExternalLink href={block.href}>{block.text}</ExternalLink>
          </p>
        );
      }
      return null;
    })}
  </>
);

// One tip open at a time within a card — the tips are alternatives to each
// other, and a card that expands to its full height pushes the grid around.
const TipsCard = ({
  categoryId,
  icon,
  tips,
}: {
  categoryId: string;
  icon: MaterialSymbol;
  tips: Tip[];
}) => {
  const { t } = useTranslation();
  const [openTip, setOpenTip] = useState<string | null>(null);

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <Icon icon={icon} size={20} />
        <h3 className={styles.cardTitle}>
          {t(`tipsandtricks.categories.${categoryId}`)}
        </h3>
      </div>
      {tips.map((tip) => (
        <Section
          key={tip.title}
          title={tip.title}
          open={openTip === tip.title}
          onOpenChange={(open) => setOpenTip(open ? tip.title : null)}
          className={styles.tip}
        >
          <TipsAndTricksContent content={tip.content} />
        </Section>
      ))}
    </div>
  );
};

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  nb: () => import('../locales/nb/tipsandtricks.json'),
  nn: () => import('../locales/nn/tipsandtricks.json'),
  en: () => import('../locales/en/tipsandtricks.json'),
};

export const HelpPage = () => {
  const { i18n, t } = useTranslation();
  const [tipsData, setTipsData] = useState<Tip[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const lang = (i18n.language || 'nb').split('-')[0];
    const load = loaders[lang] || loaders.nb;

    load()
      .then((m) => {
        if (cancelled) return;
        setTipsData(unwrapJsonModule<Tip[]>(m));
      })
      .catch((err) => {
        console.error('Feil ved lasting av tips:', err);
        if (!cancelled) setTipsData([]);
      });

    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  return (
    <>
      <header className={styles.header}>
        <Link className={styles.brand} to="/">
          Tufteseid
        </Link>
        <button
          type="button"
          className={styles.back}
          onClick={() => navigate(-1)}
        >
          {t('helpPage.header.link')}
        </button>
      </header>

      <div className={styles.page}>
        <div className={styles.column}>
          <h1 className={styles.pageTitle}>{t('helpPage.title')}</h1>

          <section className={styles.block}>
            <h2 className={styles.blockTitle}>{t('tipsandtricks.heading')}</h2>
            <p className={styles.blockText}>{t('tipsandtricks.description')}</p>
            <div className={styles.grid}>
              {categories.map((category) => {
                const tips = tipsData.filter(
                  (tip) => tip.category === category.id,
                );
                if (!tips.length) return null;
                return (
                  <TipsCard
                    key={category.id}
                    categoryId={category.id}
                    icon={category.icon}
                    tips={tips}
                  />
                );
              })}
            </div>
          </section>

          <section className={styles.block}>
            <h2 className={styles.blockTitle}>{t('about.heading')}</h2>
            <p className={styles.blockText}>{t('about.textone')}</p>
            <p className={styles.blockText}>{t('about.texttwo')}</p>
            <p className={styles.blockText}>{t('about.textthree')}</p>
            <p className={styles.build}>
              {t('about.version')}: {__COMMIT_HASH__} | {t('about.buildDate')}:{' '}
              {new Date(__BUILD_DATE__).toLocaleDateString()}
            </p>
          </section>

          {/* Unconditional. The old TopBar carried a language button; the
              ribbon does not, so gating this on `isMobile` left desktop with
              no way to change language at all. */}
          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              {t('languageSelector.chooseLanguage')}
            </h2>
            <LanguageSwitcher />
          </section>

          <section className={styles.block}>
            <h2 className={styles.blockTitle}>
              {t('helpPage.notFound.heading')}
            </h2>
            <p className={styles.blockText}>
              {t('helpPage.notFound.description')}
            </p>
            <div className={styles.sources}>
              <div>
                <h3 className={styles.sourceTitle}>
                  {t('helpPage.notFound.propertyRegisterHeading')}
                </h3>
                <p className={styles.blockText}>
                  {t('helpPage.notFound.propertyRegisterDescription')}
                </p>
                <ExternalLink href="https://eiendomsregisteret.kartverket.no/">
                  {t('helpPage.notFound.propertyRegisterButton')}
                </ExternalLink>
              </div>
              <div>
                <h3 className={styles.sourceTitle}>Norge i bilder</h3>
                <p className={styles.blockText}>
                  {t('helpPage.notFound.norgeibilderDescription')}
                </p>
                <ExternalLink href="https://www.norgeibilder.no/">
                  {t('helpPage.notFound.norgeibilderButton')}
                </ExternalLink>
              </div>
              <div>
                <h3 className={styles.sourceTitle}>Høydedata.no</h3>
                <p className={styles.blockText}>
                  {t('helpPage.notFound.hoydedataDescription')}
                </p>
                <ExternalLink href="https://hoydedata.no/">
                  {t('helpPage.notFound.hoydedataButton')}
                </ExternalLink>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};
