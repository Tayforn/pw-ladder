// =========================================================
// Адмін-панель: налаштування забігу (ресурси) і захисту (темп, перевірки
// присутності, «Талан»). Пишуться в ladder_settings через Supabase (RLS
// is_ladder_admin) і діють на НАСТУПНІ забіги. Плюс обнулення борду (сезон).
// =========================================================

import { useEffect, useState } from 'react';
import { reportError } from '../app/errorMessage';
import { resetBoard, updateGuardSettings } from '../data/ladder';
import type { RunSettings } from '../lib/apiTypes';

function NumberField({ label, value, hint, onSave }: { label: string; value: number; hint?: string; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="field admin-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = Number(v); if (!Number.isNaN(n) && n >= 0 && n !== value) onSave(n); }}
      />
      {hint && <span className="hint" style={{ margin: '2px 0 0' }}>{hint}</span>}
    </label>
  );
}

export default function AdminPanel({
  settings,
  onSettingsChanged,
  onBoardChanged,
}: {
  settings: RunSettings;
  onSettingsChanged: () => void;
  onBoardChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const save = (patch: Partial<RunSettings>) => {
    setBusy(true);
    updateGuardSettings(patch).then(onSettingsChanged).catch(reportError).finally(() => setBusy(false));
  };

  const doResetBoard = () => {
    if (!confirm('Обнулити ладдер і «Талан» (новий сезон)? Записи гравців зникнуть — історія забігів лишиться. Дію не скасувати.')) return;
    setBusy(true);
    resetBoard().then(onBoardChanged).catch(reportError).finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Ресурси на забіг</h3>
      <p className="hint" style={{ marginTop: 4, marginBottom: 12 }}>
        Міражі = ліміт спроб. Підставні — додаткові слоти предметів (0–5). Зміни діють на наступні забіги.
      </p>
      <div className="field-row admin-field-row">
        <NumberField label="Міражі (спроби)" value={settings.mirageCount} onSave={(v) => save({ mirageCount: Math.max(1, Math.min(10000, Math.round(v))) })} />
        <NumberField label="Небески" value={settings.skyCount} onSave={(v) => save({ skyCount: Math.round(v) })} />
        <NumberField label="Підземки" value={settings.underCount} onSave={(v) => save({ underCount: Math.round(v) })} />
        <NumberField label="Світобудови" value={settings.worldCount} onSave={(v) => save({ worldCount: Math.round(v) })} />
        <NumberField label="Підставні шмотки" value={settings.decoyCount} onSave={(v) => save({ decoyCount: Math.min(5, Math.round(v)) })} />
        <NumberField label="Скидання після (спроб)" value={settings.resetUnlockAttempts} hint="Тримай більшим за кількість небесок" onSave={(v) => save({ resetUnlockAttempts: Math.max(0, Math.round(v)) })} />
      </div>

      <h3 style={{ marginTop: 20 }}>Захист і рейтинг</h3>
      <div className="field-row admin-field-row">
        <NumberField label="Пауза між спробами (мс)" value={settings.minAttemptMs} hint="Темп на сервері; ~150 непомітно рукою" onSave={(v) => save({ minAttemptMs: Math.max(0, Math.min(5000, Math.round(v))) })} />
        <NumberField label="Запас швидких кліків" value={settings.burstAttempts} onSave={(v) => save({ burstAttempts: Math.max(1, Math.min(50, Math.round(v))) })} />
        <NumberField label="Перевірка раз на ~N спроб" value={settings.challengeEveryAttempts} hint="0 — вимкнути випадкові" onSave={(v) => save({ challengeEveryAttempts: Math.max(0, Math.round(v)) })} />
        <NumberField label="Перевірка після N хв гри" value={settings.sessionChallengeMinutes} hint="0 — вимкнути" onSave={(v) => save({ sessionChallengeMinutes: Math.max(0, Math.round(v)) })} />
        <NumberField label="«Талан»: перших N забігів" value={settings.talanRuns} onSave={(v) => save({ talanRuns: Math.max(1, Math.min(1000, Math.round(v))) })} />
      </div>

      <button type="button" className="btn btn-bad" disabled={busy} onClick={doResetBoard} style={{ marginTop: 16 }}>
        Обнулити ладдер (новий сезон)
      </button>
    </div>
  );
}
