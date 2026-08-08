// =========================================================
// Адмін-панель: редагування балів (успіх / вартість Небески-Підземки-
// Світобудови) і обнулення ладдера. Рендериться всередині AdminGate.
// =========================================================

import { useEffect, useState } from 'react';
import { reportError } from '../app/errorMessage';
import { resetLadder, updateSettings, type LadderSettings } from '../data/ladder';

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="field" style={{ flex: '1 1 160px' }}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 0 && n !== value) onSave(n);
        }}
      />
    </label>
  );
}

export default function AdminPanel({
  settings,
  onSettingsChanged,
  onLadderReset,
}: {
  settings: LadderSettings;
  onSettingsChanged: () => void;
  onLadderReset: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const save = (patch: Partial<LadderSettings>) => {
    setBusy(true);
    updateSettings(patch).then(onSettingsChanged).catch(reportError).finally(() => setBusy(false));
  };

  const doReset = () => {
    if (!confirm('Обнулити весь ладдер? Усі записи гравців буде видалено — дію не можна скасувати.')) return;
    setBusy(true);
    resetLadder().then(onLadderReset).catch(reportError).finally(() => setBusy(false));
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Адмін-панель</h3>
      <div className="field-row">
        <NumberField label="Балів за успішну заточку міражем" value={settings.pointsPerSuccess} onSave={(v) => save({ pointsPerSuccess: v })} />
        <NumberField label="Вартість «Небеска»" value={settings.skyCost} onSave={(v) => save({ skyCost: v })} />
        <NumberField label="Вартість «Підземка»" value={settings.underCost} onSave={(v) => save({ underCost: v })} />
        <NumberField label="Вартість «Світобудова»" value={settings.worldCost} onSave={(v) => save({ worldCost: v })} />
      </div>
      <button type="button" className="btn btn-bad" disabled={busy} onClick={doReset} style={{ marginTop: 16 }}>
        Обнулити ладдер
      </button>
    </div>
  );
}
