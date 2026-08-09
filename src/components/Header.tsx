// =========================================================
// Шапка сайту — спрощена (без бургер-меню/сайдбару, сторінка одна):
// лого, перехресні іконки на pw-calc/pw-pvp (з підписом — сама іконка
// малоінформативна), тема. Усе, крім лого, згруповано в один блок, що
// переноситься ЦІЛІСНО на мобільних — інакше окрема іконка лишається
// самотньою на своєму рядку.
// =========================================================

function toggleTheme(): void {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('ladder-theme', next);
  } catch {
    /* ignore */
  }
}

export default function Header({ onShowInfo }: { onShowInfo?: () => void }) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <a className="logo" href={import.meta.env.BASE_URL} title="На головну">
          <span className="logo-crest" aria-hidden="true">
            <img src={import.meta.env.BASE_URL + 'assets/favicon-180.png'} alt="" width={180} height={180} />
          </span>
          <span className="logo-text">Ладдер страждання</span>
        </a>

        <div className="header-actions">
          <a
            href="https://tayforn.github.io/pw.calc/refine"
            target="_blank"
            rel="noopener"
            className="partner-logo"
            title="PW Хелпер — калькулятори"
          >
            <img src={import.meta.env.BASE_URL + 'assets/pwcalc-icon.png'} alt="" />
            <span className="partner-logo-text">Хелпер</span>
          </a>
          <a
            href="https://tayforn.github.io/pw-pvp/"
            target="_blank"
            rel="noopener"
            className="partner-logo partner-logo-alt"
            title="PW PvP — турніри сервера"
          >
            <img src={import.meta.env.BASE_URL + 'assets/pwpvp-icon.png'} alt="" />
            <span className="partner-logo-text">PvP</span>
          </a>
          {onShowInfo && <button type="button" className="btn btn-ghost btn-sm" onClick={onShowInfo}>Правила</button>}
          <button
            type="button"
            className="theme-toggle"
            aria-label="Перемкнути тему"
            title="Світла / темна тема"
            onClick={toggleTheme}
          >
            <span className="theme-ico-sun" aria-hidden="true">☀</span>
            <span className="theme-ico-moon" aria-hidden="true">☾</span>
          </button>
        </div>
      </div>
    </header>
  );
}
