// =========================================================
// Адмін-вигляд сторінки (прямий захід на /admin) — винесено з App.tsx:
// гейт логіну, панель налаштувань/учасників і повна таблиця ладдера.
// =========================================================

import Header from './Header';
import Footer from './Footer';
import AdminGate from './AdminGate';
import AdminPanel from './AdminPanel';
import LadderTable from './LadderTable';
import type { LadderEntry, LadderSettings } from '../data/ladder';

export default function AdminView({
  settings,
  entries,
  reloadSettings,
  reload,
}: {
  settings: LadderSettings;
  entries: LadderEntry[];
  reloadSettings: () => void;
  reload: () => void;
}) {
  return (
    <>
      <Header />
      <div className="app-shell container">
        <main style={{ width: '100%' }}>
          <header className="section-head">
            <span className="eyebrow">Ладдер страждання</span>
            <h2>Адмін-панель</h2>
          </header>
          <AdminGate>
            {() => (
              <AdminPanel
                settings={settings}
                entries={entries}
                onSettingsChanged={reloadSettings}
                onLadderChanged={reload}
              />
            )}
          </AdminGate>
          <h3 style={{ marginTop: 28 }}>Ладдер (поточний стан)</h3>
          <div className="card">
            <LadderTable entries={entries} nickname="" />
          </div>
        </main>
      </div>
      <Footer />
    </>
  );
}
