// =========================================================
// Адмін-панель: редагування балів (успіх / вартість Небески-Підземки-
// Світобудови), об'єднання записів ладдера (гравець змінив нік) і
// обнулення ладдера цілком.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../app/errorMessage';
import { deleteLadderEntry, mergeLadderEntries, resetLadder, updateSettings, type LadderEntry, type LadderSettings } from '../data/ladder';

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
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
        onBlur={() => {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 0 && n !== value) onSave(n);
        }}
      />
    </label>
  );
}

function ParticipantsSection({ entries, onChanged }: { entries: LadderEntry[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (nick: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(nick)) next.delete(nick);
      else next.add(nick);
      return next;
    });

  const selList = [...selected];

  const merge = async () => {
    if (selList.length < 2) return;
    const finalTarget = target.trim() || selList[0];
    if (!confirm(`Об'єднати записи «${selList.join('», «')}» в один під ніком «${finalTarget}»? Інші записи буде видалено — незворотно.`)) return;
    setBusy(true);
    try {
      await mergeLadderEntries(selList, finalTarget);
      setSelected(new Set());
      setTarget('');
      onChanged();
    } catch (e) {
      alert(errorMessage(e, "Не вдалося об'єднати записи."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (nickname: string) => {
    if (!confirm(`Видалити «${nickname}» з ладдера? Весь його результат/статистика зникнуть — дію не можна скасувати.`)) return;
    setBusy(true);
    try {
      await deleteLadderEntry(nickname);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(nickname);
        return next;
      });
      onChanged();
    } catch (e) {
      alert(errorMessage(e, 'Не вдалося видалити учасника.'));
    } finally {
      setBusy(false);
    }
  };

  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ marginBottom: 6 }}>Учасники ладдера</h3>
      <p className="hint" style={{ marginBottom: 12 }}>
        Познач 2+ ніки одного гравця (напр. змінив нік у грі), щоб об'єднати в один запис із кращим результатом.
        «✕» видаляє учасника з ладдера повністю.
      </p>
      <div className="card" style={{ padding: 0, maxHeight: 320, overflowY: 'auto' }}>
        {entries.map((e) => (
          <div
            key={e.nickname}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderBottom: '1px solid var(--line)' }}
          >
            <input
              type="checkbox"
              checked={selected.has(e.nickname)}
              disabled={busy}
              onChange={() => toggle(e.nickname)}
              style={{ accentColor: 'var(--accent)', width: 17, height: 17, cursor: 'pointer', flex: '0 0 auto' }}
            />
            <span style={{ fontWeight: 600 }}>{e.nickname}</span>
            <span className="hint" style={{ margin: 0 }}>+{e.level} · {e.attempts} спроб · {e.points} балів</span>
            <button
              type="button"
              className="btn btn-bad btn-sm"
              disabled={busy}
              style={{ marginLeft: 'auto', padding: '3px 9px' }}
              title={`Видалити «${e.nickname}»`}
              onClick={() => remove(e.nickname)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {selList.length >= 2 && (
        <div className="field-row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 220px' }}>
            <span>Залишити під ніком</span>
            <input type="text" placeholder={selList[0]} value={target} onChange={(ev) => setTarget(ev.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={merge}>Об'єднати</button>
        </div>
      )}
    </div>
  );
}

export default function AdminPanel({
  settings,
  entries,
  onSettingsChanged,
  onLadderChanged,
}: {
  settings: LadderSettings;
  entries: LadderEntry[];
  onSettingsChanged: () => void;
  onLadderChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const save = (patch: Partial<LadderSettings>) => {
    setBusy(true);
    updateSettings(patch).then(onSettingsChanged).catch(reportError).finally(() => setBusy(false));
  };

  const doReset = () => {
    if (!confirm('Обнулити весь ладдер? Усі записи гравців буде видалено — дію не можна скасувати.')) return;
    setBusy(true);
    resetLadder().then(onLadderChanged).catch(reportError).finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Налаштування балів</h3>
      <div className="field-row admin-field-row">
        <NumberField label="Балів за успіх (основна)" value={settings.pointsPerSuccess} onSave={(v) => save({ pointsPerSuccess: v })} />
        <NumberField label="Балів за успіх (підставна)" value={settings.decoyPointsPerSuccess} onSave={(v) => save({ decoyPointsPerSuccess: v })} />
        <NumberField label="Вартість «Небеска»" value={settings.skyCost} onSave={(v) => save({ skyCost: v })} />
        <NumberField label="Вартість «Підземка»" value={settings.underCost} onSave={(v) => save({ underCost: v })} />
        <NumberField label="Вартість «Світобудова»" value={settings.worldCost} onSave={(v) => save({ worldCost: v })} />
      </div>
      <button type="button" className="btn btn-bad" disabled={busy} onClick={doReset} style={{ marginTop: 16 }}>
        Обнулити ладдер
      </button>

      <ParticipantsSection entries={entries} onChanged={onLadderChanged} />
    </div>
  );
}
