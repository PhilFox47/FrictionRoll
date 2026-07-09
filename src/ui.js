// UI wiring: the wand-menu trigger, a slash command, the settings panel, and
// the debug view. Uses jQuery, which SillyTavern exposes globally.

import { getST, getSettings, saveSettings } from './settings.js';
import { onManualRoll } from './state.js';
import { onDebugRender, getLastDebug, getHistory } from './debug.js';

// Fetched lazily rather than cached at module load, so load order can't leave
// us with a stale/undefined reference.
const jq = () => globalThis.jQuery;

function addWandButton() {
    const $ = jq();
    if (!$ || document.getElementById('outcome_roll_wand')) return;
    const $btn = $(`
        <div id="outcome_roll_wand" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Roll for an externally-adjudicated outcome">
            <div class="fa-solid fa-dice extensionsMenuExtensionButton"></div>
            <span>Roll for it</span>
        </div>`);
    $btn.on('click', () => onManualRoll());
    $btn.on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onManualRoll(); } });

    const menu = document.getElementById('extensionsMenu');
    if (menu) $(menu).append($btn);
}

function registerSlashCommand() {
    const ctx = getST();
    if (!ctx?.registerSlashCommand) return;
    try {
        ctx.registerSlashCommand(
            'roll-outcome',
            () => { onManualRoll(); return ''; },
            ['rollfor', 'outcomeroll'],
            '– roll for an externally-adjudicated outcome (Outcome Roll extension).',
            true,
            true,
        );
    } catch (e) {
        console.warn('[Outcome Roll] slash command registration failed', e);
    }
}

const SETTINGS_HTML = `
<div id="outcome_roll_settings" class="outcome-roll-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🎲 Outcome Roll</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label" for="or_enabled">
        <input type="checkbox" id="or_enabled"><span>Enabled</span>
      </label>
      <small class="or-hint">If never triggered, the extension does nothing — no side-calls, no injection.</small>

      <div class="or-row">
        <label>Outcome count (min / max)</label>
        <div class="or-inline">
          <input type="number" id="or_minOutcomes" min="2" max="8" class="text_pole">
          <input type="number" id="or_maxOutcomes" min="2" max="8" class="text_pole">
        </div>
      </div>

      <div class="or-row">
        <label>Percentage floor / ceiling</label>
        <div class="or-inline">
          <input type="number" id="or_floor" min="1" max="99" class="text_pole">
          <input type="number" id="or_ceiling" min="1" max="99" class="text_pole">
        </div>
      </div>

      <div class="or-row">
        <label>Context: message count / token budget</label>
        <div class="or-inline">
          <input type="number" id="or_contextMessageCount" min="1" max="50" class="text_pole">
          <input type="number" id="or_contextTokenBudget" min="200" max="8000" step="50" class="text_pole">
        </div>
      </div>

      <div class="or-row">
        <label for="or_connectionProfileId">Connection for the side-call</label>
        <select id="or_connectionProfileId" class="text_pole">
          <option value="">Reuse active chat connection</option>
        </select>
      </div>

      <div class="or-row">
        <label for="or_temperature">Side-call temperature</label>
        <input type="number" id="or_temperature" min="0" max="2" step="0.05" class="text_pole">
        <small class="or-hint">Structured output wants a low, deterministic value. Applied on the side-call.</small>
      </div>

      <label class="checkbox_label" for="or_autoRollOnSend">
        <input type="checkbox" id="or_autoRollOnSend"><span>Roll automatically on every message you send</span>
      </label>
      <small class="or-hint">On: every send rolls before the reply is generated. Off: rolls only via the 🎲 button / <code>/roll-outcome</code>.</small>
      <label class="checkbox_label" for="or_promptForAction">
        <input type="checkbox" id="or_promptForAction"><span>Prompt to edit the action before rolling (manual button only)</span>
      </label>
      <label class="checkbox_label" for="or_autoRerollOnSwipe">
        <input type="checkbox" id="or_autoRerollOnSwipe"><span>Automatic fresh roll when swiping the reply</span>
      </label>
      <label class="checkbox_label" for="or_complianceCheck">
        <input type="checkbox" id="or_complianceCheck"><span>Check whether the outcome lands prominently (early in the reply)</span>
      </label>
      <label class="checkbox_label" for="or_autoRegenerateOnMiss">
        <input type="checkbox" id="or_autoRegenerateOnMiss"><span>Regenerate once when the outcome is missing or buried</span>
      </label>
      <small class="or-hint">Requires the preset to embed the <code>{{frictionroll}}</code> macro in its final-instruction block. Compliance is a heuristic; small models won't hit 100%. Auto-regenerate costs one extra generation on a failed beat.</small>
      <label class="checkbox_label" for="or_showResultAfter">
        <input type="checkbox" id="or_showResultAfter"><span>Show roll result as flavor AFTER the reply</span>
      </label>
      <small class="or-hint">Hidden by default — showing it before defeats the purpose; after is fine.</small>

      <div class="inline-drawer or-debug-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Debug — last menu &amp; roll</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <pre id="or_debug_out" class="or-debug">No rolls yet.</pre>
        </div>
      </div>
    </div>
  </div>
</div>`;

// id -> settings key + coercion type.
const FIELDS = {
    or_enabled: ['enabled', 'bool'],
    or_minOutcomes: ['minOutcomes', 'int'],
    or_maxOutcomes: ['maxOutcomes', 'int'],
    or_floor: ['floor', 'int'],
    or_ceiling: ['ceiling', 'int'],
    or_contextMessageCount: ['contextMessageCount', 'int'],
    or_contextTokenBudget: ['contextTokenBudget', 'int'],
    or_connectionProfileId: ['connectionProfileId', 'str'],
    or_temperature: ['temperature', 'float'],
    or_autoRollOnSend: ['autoRollOnSend', 'bool'],
    or_promptForAction: ['promptForAction', 'bool'],
    or_autoRerollOnSwipe: ['autoRerollOnSwipe', 'bool'],
    or_complianceCheck: ['complianceCheck', 'bool'],
    or_autoRegenerateOnMiss: ['autoRegenerateOnMiss', 'bool'],
    or_showResultAfter: ['showResultAfter', 'bool'],
};

function coerce(type, el) {
    if (type === 'bool') return !!el.checked;
    if (type === 'int') { const n = parseInt(el.value, 10); return Number.isFinite(n) ? n : 0; }
    if (type === 'float') { const n = parseFloat(el.value); return Number.isFinite(n) ? n : 0; }
    return el.value;
}

function loadFieldValues() {
    const s = getSettings();
    for (const [id, [key, type]] of Object.entries(FIELDS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (type === 'bool') el.checked = !!s[key];
        else el.value = s[key];
    }
}

function bindFields() {
    const s = getSettings();
    for (const [id, [key, type]] of Object.entries(FIELDS)) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', () => {
            let v = coerce(type, el);
            // Keep the min/max pairs sane.
            if (key === 'maxOutcomes' && v < s.minOutcomes) v = s.minOutcomes;
            if (key === 'minOutcomes' && v > s.maxOutcomes) v = s.maxOutcomes;
            if (key === 'ceiling' && v < s.floor) v = s.floor;
            if (key === 'floor' && v > s.ceiling) v = s.ceiling;
            s[key] = v;
            if (type !== 'str' && type !== 'bool') el.value = v;
            saveSettings();
        });
    }
}

function refreshProfiles() {
    const ctx = getST();
    const sel = document.getElementById('or_connectionProfileId');
    if (!sel) return;
    const current = getSettings().connectionProfileId;

    // Reset to just the "reuse active" option.
    sel.innerHTML = '<option value="">Reuse active chat connection</option>';
    try {
        const CM = ctx?.ConnectionManagerRequestService;
        const profiles = CM?.getSupportedProfiles?.() ?? [];
        for (const p of profiles) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name ?? p.id;
            sel.appendChild(opt);
        }
    } catch {
        // Connection Manager unavailable/disabled — reuse-active is the only option.
    }
    sel.value = current || '';
}

function renderDebug(last, history) {
    const out = document.getElementById('or_debug_out');
    if (!out) return;
    const d = last ?? getLastDebug();
    if (!d) { out.textContent = 'No rolls yet.'; return; }

    const lines = [];
    lines.push(`[${d.at}] mode: ${d.mode}`);
    if (d.error) lines.push(`ERROR: ${d.error}`);
    if (d.partial) lines.push(`WARNING: missing tag(s): ${(d.missing || []).join(', ') || '(none survived)'}`);
    lines.push(`action: ${d.action || '(none)'}`);
    if (Array.isArray(d.menu) && d.menu.length) {
        lines.push('menu (normalized):');
        for (const o of d.menu) lines.push(`  ${String(o.start).padStart(3)}-${String(o.end).padEnd(3)}  ${o.tag.padEnd(7)} ${o.pct}%  ${o.text}`);
    }
    if (d.roll != null) lines.push(`roll: ${d.roll}/100`);
    if (d.selected) lines.push(`SELECTED -> ${d.selected.tag}: ${d.selected.text}`);
    if (d.compliance) {
        lines.push(`compliance: ${d.compliance.toUpperCase()}  (looked for: ${(d.complianceTokens || []).join(', ')}${d.complianceHits?.length ? `; matched: ${d.complianceHits.join(', ')}` : ''})`);
    }
    lines.push('');
    lines.push('--- raw side-call response ---');
    lines.push(d.raw ?? '(empty)');

    const count = (history ?? getHistory()).length;
    if (count > 1) lines.push(`\n(${count} rolls in history this session)`);
    out.textContent = lines.join('\n');
}

function addSettingsPanel() {
    const $ = jq();
    if (!$ || document.getElementById('outcome_roll_settings')) return;
    const container = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (!container) return;
    $(container).append(SETTINGS_HTML);
    loadFieldValues();
    bindFields();
    refreshProfiles();
    onDebugRender(renderDebug);
    renderDebug();
}

export function initUI() {
    addWandButton();
    registerSlashCommand();
    addSettingsPanel();
}
