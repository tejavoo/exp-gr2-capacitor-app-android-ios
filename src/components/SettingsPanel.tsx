import { useState } from 'react';
import { useCameraStore } from '../store/camera';

interface Opt { label: string; cmds: string[] }
interface Setting { key: string; label: string; opts: Opt[] }

// Exact command strings from the original GR Remote HTML (data-gr attributes).
// Values are fully prefixed; the short forms in the summarised spec are NOT valid.
const p = (key: string, value: string, ...extra: string[]): string[] => [`pset=${key} ${value}`, ...extra];

const SETTINGS: Setting[] = [
  { key: 'WB', label: 'White Balance', opts: [
    { label: 'Auto',        cmds: p('WB', 'WB_MODE_AUTO') },
    { label: 'Multi-P Auto', cmds: p('WB', 'WB_MODE_I_AUTO') },
    { label: 'Daylight',    cmds: p('WB', 'WB_MODE_DAYLIGHT') },
    { label: 'Shade',       cmds: p('WB', 'WB_MODE_SHADE') },
    { label: 'Cloudy',      cmds: p('WB', 'WB_MODE_CLOUDY') },
    { label: 'Incandescent 1', cmds: p('WB', 'WB_MODE_INCANDESCENT1') },
    { label: 'Incandescent 2', cmds: p('WB', 'WB_MODE_INCANDESCENT2') },
    { label: 'Daylight Fluor.', cmds: p('WB', 'WB_MODE_FLUORESCENT1') },
    { label: 'Neutral Fluor.',  cmds: p('WB', 'WB_MODE_FLUORESCENT2') },
    { label: 'Cool Fluor.',     cmds: p('WB', 'WB_MODE_FLUORESCENT3') },
    { label: 'Warm Fluor.',     cmds: p('WB', 'WB_MODE_FLUORESCENT4') },
    { label: 'CTE',         cmds: p('WB', 'WB_MODE_CTE') },
    { label: 'Custom',      cmds: p('WB', 'WB_MODE_CUSTOM') },
    { label: 'Manual',      cmds: p('WB', 'WB_MODE_MANUAL') },
  ]},
  { key: 'FOCUS', label: 'Focus', opts: [
    { label: 'Multi',    cmds: p('FOCUS', 'FOCUS_MODE_MULTI') },
    { label: 'Spot',     cmds: p('FOCUS', 'FOCUS_MODE_SPOT') },
    { label: 'Pinpoint', cmds: p('FOCUS', 'FOCUS_MODE_PINPOINT') },
    { label: 'Tracking', cmds: p('FOCUS', 'FOCUS_MODE_TRACKING') },
    { label: 'MF',       cmds: p('FOCUS', 'FOCUS_MODE_MANUAL') },
    { label: 'Snap',     cmds: p('FOCUS', 'FOCUS_MODE_SNAP') },
    { label: 'Infinity', cmds: p('FOCUS', 'FOCUS_MODE_INFINITY') },
  ]},
  { key: 'EXP_METERING', label: 'Metering', opts: [
    { label: 'Multi',  cmds: p('EXP_METERING', 'METERING_MODE_MULTI') },
    { label: 'Center', cmds: p('EXP_METERING', 'METERING_MODE_CENTER') },
    { label: 'Spot',   cmds: p('EXP_METERING', 'METERING_MODE_SPOT') },
  ]},
  { key: 'FLASH', label: 'Flash', opts: [
    { label: 'Auto',       cmds: p('FLASH', 'FLASH_MODE_AUTO') },
    { label: 'On',         cmds: p('FLASH', 'FLASH_MODE_ON') },
    { label: 'Off',        cmds: p('FLASH', 'FLASH_MODE_OFF') },
    { label: 'Slow Sync',  cmds: p('FLASH', 'FLASH_MODE_SLOW_SYNC') },
    { label: 'Manual',     cmds: p('FLASH', 'FLASH_MODE_MANUAL') },
    { label: 'Auto (red-eye)', cmds: p('FLASH', 'FLASH_MODE_REDEYE') },
    { label: 'On (red-eye)',   cmds: p('FLASH', 'FLASH_MODE_REDEYE_ON') },
    { label: 'Sync (red-eye)', cmds: p('FLASH', 'FLASH_MODE_REDEYE_SLOW_SYNC') },
    { label: 'Wireless',   cmds: p('FLASH', 'FLASH_MODE_WIRELESS') },
  ]},
  { key: 'SELFTIMER', label: 'Self Timer', opts: [
    { label: 'Off',   cmds: p('SELFTIMER', 'SELF_MODE_OFF', 'cmd=mode refresh') },
    { label: '2 sec', cmds: p('SELFTIMER', 'SELF_MODE_2SEC', 'cmd=mode refresh') },
  ]},
  { key: 'CONT_MODE', label: 'Drive', opts: [
    { label: 'Single',     cmds: p('CONT_MODE', 'CONT_MODE_SINGLE') },
    { label: 'Continuous', cmds: p('CONT_MODE', 'CONT_MODE_CONTINUOUS') },
  ]},
  { key: 'AUTO_BKT', label: 'Bracketing', opts: [
    { label: 'Off',          cmds: p('AUTO_BKT', 'CONT_MODE_SINGLE') },
    { label: 'AEB 1/3 EV',   cmds: p('AUTO_BKT', 'CONT_MODE_BKT_AE_03') },
    { label: 'AEB 1/2 EV',   cmds: p('AUTO_BKT', 'CONT_MODE_BKT_AE') },
    { label: 'WB',           cmds: p('AUTO_BKT', 'CONT_MODE_BKT_WB') },
    { label: 'WB preset',    cmds: p('AUTO_BKT', 'CONT_MODE_BKT_WB_PRESET') },
    { label: 'Effect',       cmds: p('AUTO_BKT', 'CONT_MODE_BKT_EFX') },
    { label: 'DR',           cmds: p('AUTO_BKT', 'CONT_MODE_BKT_DR') },
    { label: 'Contrast',     cmds: p('AUTO_BKT', 'CONT_MODE_BKT_CONTRAST') },
  ]},
  { key: 'PICT_SIZE', label: 'Image Size', opts: [
    { label: 'L (JPEG)',   cmds: p('PICT_SIZE', 'PICT_SIZE_L', 'pset=PICT_QUALITY IMAGE_QUALITY_FINE') },
    { label: 'M (JPEG)',   cmds: p('PICT_SIZE', 'PICT_SIZE_M', 'pset=PICT_QUALITY IMAGE_QUALITY_FINE') },
    { label: 'S (JPEG)',   cmds: p('PICT_SIZE', 'PICT_SIZE_S', 'pset=PICT_QUALITY IMAGE_QUALITY_FINE') },
    { label: 'XS (JPEG)',  cmds: p('PICT_SIZE', 'PICT_SIZE_XS', 'pset=PICT_QUALITY IMAGE_QUALITY_FINE') },
    { label: 'RAW',        cmds: p('PICT_SIZE', 'PICT_SIZE_RAW', 'pset=PICT_QUALITY IMAGE_QUALITY_NO_COMPRESSION') },
    { label: 'RAW + JPEG', cmds: p('PICT_SIZE', 'PICT_SIZE_RAW_JPEG', 'pset=PICT_QUALITY IMAGE_QUALITY_NO_COMPRESSION') },
  ]},
  { key: 'PICT_ASPECT', label: 'Aspect', opts: [
    { label: '3:2', cmds: p('PICT_ASPECT', 'ASPECT_3_2') },
    { label: '4:3', cmds: p('PICT_ASPECT', 'ASPECT_4_3') },
    { label: '1:1', cmds: p('PICT_ASPECT', 'ASPECT_1_1') },
  ]},
  { key: 'CROP_SHOOTING', label: 'Crop', opts: [
    { label: 'Off (28mm)', cmds: p('CROP_SHOOTING', 'CROP_SIZE_ORIGINAL') },
    { label: '35mm',       cmds: p('CROP_SHOOTING', 'CROP_SIZE_M') },
    { label: '47mm',       cmds: p('CROP_SHOOTING', 'CROP_SIZE_S') },
  ]},
  { key: 'IMAGE_SETTINGS', label: 'Image Setting', opts: [
    { label: 'Standard',  cmds: p('IMAGE_SETTINGS', 'COLOR_MODE_STANDARD') },
    { label: 'Vivid',     cmds: p('IMAGE_SETTINGS', 'COLOR_MODE_VIVID') },
    { label: 'Setting 1', cmds: p('IMAGE_SETTINGS', 'COLOR_MODE_CUSTOM1') },
    { label: 'Setting 2', cmds: p('IMAGE_SETTINGS', 'COLOR_MODE_CUSTOM2') },
  ]},
  { key: 'EFFECT', label: 'Effect', opts: [
    { label: 'Off',          cmds: p('EFFECT', 'COLOR_MODE_STANDARD') },
    { label: 'B&W',          cmds: p('EFFECT', 'COLOR_MODE_BW') },
    { label: 'B&W (TE)',     cmds: p('EFFECT', 'COLOR_MODE_BW_TE') },
    { label: 'Hi-Con B&W',   cmds: p('EFFECT', 'COLOR_MODE_HIGH_BW') },
    { label: 'Cross Process', cmds: p('EFFECT', 'COLOR_MODE_CROSS_PROCESS') },
    { label: 'Positive Film', cmds: p('EFFECT', 'COLOR_MODE_POSI_FILM') },
    { label: 'Bleach Bypass', cmds: p('EFFECT', 'COLOR_MODE_BLEACH_BYPASS') },
    { label: 'Retro',        cmds: p('EFFECT', 'COLOR_MODE_RETRO') },
    { label: 'Miniature',    cmds: p('EFFECT', 'COLOR_MODE_MINIATURE') },
    { label: 'Shift Crop',   cmds: p('EFFECT', 'COLOR_MODE_SHIFT_CROP') },
    { label: 'High Key',     cmds: p('EFFECT', 'COLOR_MODE_HIGH_KEY') },
    { label: 'HDR Tone',     cmds: p('EFFECT', 'COLOR_MODE_HDR_TONE') },
    { label: 'Clarity',      cmds: p('EFFECT', 'COLOR_MODE_CLARITY') },
    { label: 'Brilliance',   cmds: p('EFFECT', 'COLOR_MODE_SHINY') },
    { label: 'Slight',       cmds: p('EFFECT', 'COLOR_MODE_SLIGHT') },
    { label: 'Vibrant',      cmds: p('EFFECT', 'COLOR_MODE_MIYABI') },
    { label: 'Bright',       cmds: p('EFFECT', 'COLOR_MODE_BRIGHT') },
    { label: 'Portrait',     cmds: p('EFFECT', 'COLOR_MODE_PORTRAIT') },
  ]},
  { key: 'DYN_RANGE_COMP', label: 'DR Comp', opts: [
    { label: 'Off',    cmds: p('DYN_RANGE_COMP', 'DYNAMIC_RANGE_OFF') },
    { label: 'Auto',   cmds: p('DYN_RANGE_COMP', 'DYNAMIC_RANGE_AUTO') },
    { label: 'Weak',   cmds: p('DYN_RANGE_COMP', 'DYNAMIC_RANGE_WEAK') },
    { label: 'Medium', cmds: p('DYN_RANGE_COMP', 'DYNAMIC_RANGE_MEDIUM') },
    { label: 'Strong', cmds: p('DYN_RANGE_COMP', 'DYNAMIC_RANGE_STRONG') },
  ]},
  { key: 'LENS_LOCK', label: 'Lens Lock', opts: [
    { label: 'Off',  cmds: p('LENS_LOCK', '0', 'cmd=acclock off') },
    { label: 'Lock', cmds: p('LENS_LOCK', '1', 'cmd=acclock on') },
  ]},
];

const optValue = (o: Opt) => o.cmds.join('&');
const byKey = Object.fromEntries(SETTINGS.map(s => [s.key, s]));

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Light & colour', keys: ['WB', 'FLASH', 'DYN_RANGE_COMP', 'IMAGE_SETTINGS', 'EFFECT'] },
  { title: 'Focus & metering', keys: ['FOCUS', 'EXP_METERING'] },
  { title: 'Drive', keys: ['CONT_MODE', 'SELFTIMER', 'AUTO_BKT'] },
  { title: 'File', keys: ['PICT_SIZE', 'PICT_ASPECT', 'CROP_SHOOTING'] },
  { title: 'Lens', keys: ['LENS_LOCK'] },
];

const SEGMENT_MAX = 4;

export function SettingsPanel() {
  const status = useCameraStore(s => s.status);
  const applied = useCameraStore(s => s.settings);
  const applySetting = useCameraStore(s => s.applySetting);
  const [busy, setBusy] = useState<string | null>(null);
  const disabled = status !== 'connected';

  const apply = async (setting: Setting, value: string) => {
    const opt = setting.opts.find(o => optValue(o) === value);
    if (!opt || disabled || busy) return;
    setBusy(setting.key);
    try {
      await applySetting(setting.key, value, opt.cmds, `${setting.label}: ${opt.label}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 space-y-6">
      {disabled && (
        <p className="text-xs rounded-xl p-3" style={{ background: 'var(--color-cam-card)', color: 'var(--color-cam-muted)' }}>
          Connect to the camera to change settings.
        </p>
      )}

      {GROUPS.map(group => (
        <section key={group.title} className="space-y-3">
          <p className="label">{group.title}</p>
          {group.keys.map(k => {
            const setting = byKey[k];
            const value = applied[k] || '';
            const isBusy = busy === k;
            return (
              <div key={k} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium" style={{ color: 'var(--color-cam-text)' }}>{setting.label}</span>
                  <span className="text-[11px]" style={{ color: isBusy ? 'var(--color-cam-accent)' : value ? 'var(--color-cam-green)' : 'var(--color-cam-dim)' }}>
                    {isBusy ? 'sending…' : value ? '✓ set' : 'not set'}
                  </span>
                </div>
                {setting.opts.length <= SEGMENT_MAX ? (
                  <div className="seg" role="radiogroup" aria-label={setting.label}>
                    {setting.opts.map(o => (
                      <button
                        key={optValue(o)}
                        role="radio"
                        aria-checked={optValue(o) === value}
                        data-active={optValue(o) === value}
                        disabled={disabled || !!busy}
                        onClick={() => apply(setting, optValue(o))}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    value={value}
                    onChange={e => apply(setting, e.target.value)}
                    disabled={disabled || !!busy}
                    className="cam-select"
                    aria-label={setting.label}
                    style={{ borderColor: value ? 'rgba(62,207,110,.5)' : undefined }}
                  >
                    <option value="" disabled>Choose…</option>
                    {setting.opts.map(o => <option key={optValue(o)} value={optValue(o)}>{o.label}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-cam-dim)' }}>
        Changes are sent immediately. The camera can’t report its current settings over Wi-Fi,
        so “not set” means “not changed from this app”.
      </p>
    </div>
  );
}
