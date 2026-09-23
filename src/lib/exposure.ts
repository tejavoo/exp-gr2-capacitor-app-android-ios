import type { ExposureField } from '../store/camera';

export const MODES = ['AUTO', 'P', 'AV', 'TV', 'M', 'TAV', 'MY1', 'MY2', 'MY3', 'MOVIE'] as const;

// Exact values the original GR Remote sends (llms_protocol §5).
export const OPTIONS: Record<ExposureField, string[]> = {
  sv: ['auto', 'auto_hi', '100', '200', '400', '800', '1600', '3200'],
  av: ['2.8', '4.0', '5.6', '8.0', '11', '16'],
  tv: ['T', '4.1', '2.1', '1.1', '1.2', '1.4', '1.8', '1.15', '1.30', '1.60', '1.125', '1.250', '1.500', '1.1000', '1.2000'],
  xv: ['-3.0', '-2.7', '-2.3', '-2.0', '-1.7', '-1.3', '-1.0', '-0.7', '-0.3', '0.0', '+0.3', '+0.7', '+1.0', '+1.3', '+1.7', '+2.0', '+2.3', '+2.7', '+3.0'],
};

export const FIELD_LABEL: Record<ExposureField, string> = { sv: 'ISO', av: 'F', tv: 'SS', xv: 'EV' };
export const FIELD_NAME: Record<ExposureField, string> = { sv: 'ISO', av: 'Aperture', tv: 'Shutter', xv: 'EV comp' };

export function formatValue(field: ExposureField, v: string): string {
  if (!v) return '—';
  switch (field) {
    case 'sv': return v === 'auto' ? 'Auto' : v === 'auto_hi' ? 'Auto Hi' : v;
    case 'av': return v;
    case 'tv': {
      if (v === 'T') return 'T';
      const [n, d] = v.split('.');
      return d === '1' ? `${n}"` : `${n}/${d}`;
    }
    case 'xv': return v === '0.0' ? '±0' : v;
  }
}

const AV_MODES = new Set(['AV', 'M', 'TAV']);
const TV_MODES = new Set(['TV', 'M', 'TAV']);
const SV_AUTO_MODES = new Set(['AUTO', 'TAV']);
const XV_OFF_MODES = new Set(['AUTO', 'M']);

// True when the current mode means the camera will not use a value written for `field`.
export function ignoredInMode(field: ExposureField, mode: string): boolean {
  if (!mode || mode.startsWith('MY') || mode === 'MOVIE') return false;
  switch (field) {
    case 'av': return !AV_MODES.has(mode);
    case 'tv': return !TV_MODES.has(mode);
    case 'sv': return SV_AUTO_MODES.has(mode);
    case 'xv': return XV_OFF_MODES.has(mode);
  }
}

export function modeHint(field: ExposureField, mode: string): string {
  const where: Record<ExposureField, string> = {
    av: 'AV, M or TAV',
    tv: 'TV, M or TAV',
    sv: 'P, AV, TV or M',
    xv: 'P, AV, TV or TAV',
  };
  return `${mode} controls ${FIELD_NAME[field].toLowerCase()} itself — switch to ${where[field]} to use it.`;
}
