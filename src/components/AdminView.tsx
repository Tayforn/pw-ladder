// =========================================================
// Адмін-вигляд (/admin): вхід (той самий Supabase-логін ladder_admins),
// панель налаштувань/захисту й поточний ладдер (лише читання).
// =========================================================

import Header from './Header';
import Footer from './Footer';
import AdminGate from './AdminGate';
import AdminPanel from './AdminPanel';
import LadderTable from './LadderTable';
import type { BoardEntry, RunSettings } from '../lib/apiTypes';

export default function AdminView({
  settings,
  board,
  reload,
  reloadSettings,
}: {
  settings: RunSettings;
  board: BoardEntry[];
  reload: () => void;
  reloadSettings: () => void;
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
            {() => <AdminPanel settings={settings} onSettingsChanged={reloadSettings} onBoardChanged={reload} />}
          </AdminGate>
          <h3 style={{ marginTop: 28 }}>Ладдер (поточний стан)</h3>
          <div className="card"><LadderTable board={board} /></div>
        </main>
      </div>
      <Footer />
    </>
  );
}
