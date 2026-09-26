/*
 * NAVIGATION HEADER
 * FILE: src/services/serverRulesService.js
 * LAYER: Service layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: Usually consumed by handlers, routers, or microservices.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const {
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const { loadJson, saveJson } = require('../storage/jsonStore');
const serverSettings = require('./serverSettingsService');

const FILE = 'serverRulesProfile.json';

const RULE_LIBRARY = [
  ['respect_mods','Respect moderator and commissioner decisions in public channels.','warning'],
  ['no_hate','No slurs, hateful conduct, or targeted harassment.','warning+boot'],
  ['trash_talk_ok','Trash talk is allowed. Keep it competitive, not hateful.','reminder'],
  ['no_spam','No spam walls, mass repeats, or attention farming.','warning'],
  ['no_scams','No scam links, phishing, or fake giveaways.','warning+boot'],
  ['right_channels','Use the right channels for the right topics.','reminder'],
  ['no_nsfl','No gore or wildly inappropriate media.','warning+boot'],
  ['no_doxx','No doxxing or posting private info.','warning+boot'],
  ['no_raid','No raiding, brigading, or coordinated harassment.','warning+boot'],
  ['no_impersonation','Do not impersonate staff, players, or the bot.','warning'],
  ['no_fake_scores','No fake score reports or fake commissioner announcements.','warning+boot'],
  ['no_alt_evasion','No ban evasion or rule evasion through alts.','warning+boot'],
  ['keep_voice_clean','If voice chat is used, keep it under the same server rules.','warning'],
  ['no_lobbying','Do not lobby staff with repeated pings for the same issue.','reminder'],
  ['no_team_sabotage','No griefing your own team or league to ruin seasons.','warning'],
  ['no_bot_abuse','Do not intentionally spam or break bot workflows.','warning'],
  ['no_fake_claims','No claiming teams or achievements you did not earn.','warning'],
  ['be_reachable','If you join a league, stay reachable and respond in a reasonable time.','warning'],
  ['scheduling_respect','Respect scheduling windows and opponent availability.','warning'],
  ['stream_honesty','Do not fake stream credits or reward milestones.','warning'],
  ['no_exploit_talk','Do not promote cheats, exploits, or malicious behavior.','warning+boot'],
  ['cool_off','If staff tells a situation to cool off, let it cool off.','warning'],
  ['no_porn','No pornographic content or sexual harassment.','warning+boot'],
  ['no_sales_spam','No unrelated selling, promo spam, or self-ad spam.','warning'],
  ['no_threats','No threats of violence or intimidation.','warning+boot'],
  ['take_it_to_dms','Personal beef should leave the public channels.','reminder'],
  ['no_name_abuse','No racist or hateful names for teams, logos, or imports.','warning+boot'],
  ['keep_help_clear','If someone is asking for help, do not drown the answer in nonsense.','reminder'],
  ['respect_privacy','Do not repost private DMs without permission.','warning'],
  ['staff_final_call','Staff has final say on server moderation calls.','warning'],
];

const TEMPLATE_RULE_EXTRAS = {
  gaming: ['No rage-quitting or griefing league flow.', 'Use the right game, clip, and league lanes for match traffic.'],
  sports: ['Keep score, standings, and fantasy talk in sports lanes.', 'Do not flood live score channels with unrelated chatter.'],
  educational: ['Keep answers readable and useful when people ask for help.', 'Assignments, labs, and office-hours lanes should stay on topic.'],
  movie: ['Use spoiler lanes for plot-heavy discussion.', 'Watch-party planning and review lanes should stay separate.'],
  professional: ['Keep networking and jobs lanes cleaner and more professional.', 'Do not spam recruiting or self-promo outside the proper lane.'],
  community: ['Keep casual chat in social lanes and avoid drowning out announcements.'],
  creative: ['Give critique constructively and keep showcase lanes focused on posted work.'],
  fandom: ['Respect spoiler boundaries and keep fan content in the right lane.'],
  support: ['Keep peer support calm, respectful, and free of pile-ons.'],
  event: ['Use schedule and live-update lanes for campaign or event traffic.'],
};

const ENFORCEMENT_LABELS = {
  reminder: 'Reminder',
  warning: 'Warning',
  'warning+boot': 'Warning + potential boot',
  severe: 'Immediate warning + potential boot',
};

function getProfile() {
  const raw = loadJson(FILE, null);
  return raw && typeof raw === 'object' ? raw : { selected: [], customText: '', updatedAt: null };
}

function saveProfile(profile) {
  const out = { ...profile, updatedAt: Date.now() };
  saveJson(FILE, out);
  return out;
}

function resetProfile() {
  const out = { selected: [], customText: '', updatedAt: Date.now() };
  saveJson(FILE, out);
  return out;
}

function _defaultRules() {
  return RULE_LIBRARY.slice(0, 10).map(([id, text, level]) => ({ id, text, level }));
}

function _selectedRules(profile = getProfile()) {
  const picked = Array.isArray(profile.selected) ? profile.selected.filter(r => r && r.id && r.text) : [];
  return picked.length ? picked : _defaultRules();
}

function _chunk(items = [], size = 4) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function _ruleLine(ruleOrText, idxOrText, level) {
  if (ruleOrText && typeof ruleOrText === 'object') {
    const idx = Number(idxOrText) || 1;
    return `**${idx}.** ${ruleOrText.text}\n> Enforcement: **${ENFORCEMENT_LABELS[ruleOrText.level] || ruleOrText.level}**`;
  }
  const idx = Number(ruleOrText) || 1;
  return `**${idx}.** ${idxOrText}\n> Enforcement: **${ENFORCEMENT_LABELS[level] || level}**`;
}

function listRulesText() {
  return RULE_LIBRARY.map((r, i) => `**${i + 1}.** ${r[1]} _(default: ${ENFORCEMENT_LABELS[r[2]]})_`).join('\n');
}

function buildServerRulesText(profile = getProfile()) {
  const selected = _selectedRules(profile);
  const lines = selected.map((r, i) => `**${i + 1}.** ${r.text}\n> Enforcement: **${ENFORCEMENT_LABELS[r.level] || r.level}**`);
  const extra = profile.customText ? `\n\n**Custom Notes**\n${profile.customText}` : '';
  return [
    'These are this server\'s base conduct rules. League-specific gameplay rules are equipped separately after a league is created.',
    '',
    ...lines,
    extra,
  ].join('\n');
}

async function publishServerRules(guild) {
  const ch = guild.channels.cache.find(c => c.isTextBased?.() && c.name === 'rules');
  if (!ch) return false;
  const recent = await ch.messages.fetch({ limit: 25 }).catch(() => null);
  for (const m of (recent ? [...recent.values()] : [])) {
    if (m.author?.id === guild.members.me?.id && /Server Rules/i.test(String(m.embeds?.[0]?.title || ''))) {
      await m.delete().catch(() => null);
    }
  }
  await ch.send({
    embeds: [new EmbedBuilder().setColor(0x4da3ff).setTitle('📖 Server Rules').setDescription(buildServerRulesText()).setTimestamp()],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return true;
}

function buildWizardEmbed(profile = getProfile()) {
  const selected = _selectedRules(profile);
  const preview = selected.slice(0, 5).map((rule, idx) => _ruleLine(rule, idx + 1)).join('\n\n');
  const extraCount = Math.max(0, selected.length - 5);
  const customNote = String(profile.customText || '').trim();
  return new EmbedBuilder()
    .setColor(0x4da3ff)
    .setTitle('🛠 Customize Server Rules (Optional)')
    .setDescription(
      'Choose the **base server rules** here. These are not league gameplay rules. Keep them clean, short, and readable on mobile.\n\n' +
      '**Fast path**\n' +
      '1. Use the two picklists to turn standard rules on or off.\n' +
      '2. Use **Add Custom Rules / Notes** for custom wording or enforcement changes.\n' +
      '3. Use **Refresh Rules Preview Now** to republish the preview below in a cleaner format.'
    )
    .addFields(
      {
        name: 'Current selection',
        value: `Selected standard rules: **${selected.length}**\nCustom notes saved: **${customNote ? 'Yes' : 'No'}**`,
      },
      {
        name: 'Preview snapshot',
        value: preview + (extraCount ? `\n\n…and **${extraCount}** more selected rule(s).` : ''),
      },
      {
        name: 'Override examples',
        value: '`3=warning+boot`\n`7=reminder`\n`12=severe`',
      },
    )
    .setFooter({ text: 'Server rules should explain the lane clearly, not read like a legal brick.' })
    .setTimestamp();
}

function buildRuleSelectRows(profile = getProfile()) {
  const selectedIds = new Set((_selectedRules(profile) || []).map(r => r.id));
  const partA = RULE_LIBRARY.slice(0, 15).map(([id, text]) => ({ label: text.slice(0, 100), value: id, default: selectedIds.has(id) }));
  const partB = RULE_LIBRARY.slice(15, 30).map(([id, text]) => ({ label: text.slice(0, 100), value: id, default: selectedIds.has(id) }));
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('server_rules_select_a')
      .setPlaceholder('Toggle standard server rules (1-15)...')
      .setMinValues(0)
      .setMaxValues(Math.min(15, partA.length || 1))
      .addOptions(partA)
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('server_rules_select_b')
      .setPlaceholder('Toggle standard server rules (16-30)...')
      .setMinValues(0)
      .setMaxValues(Math.min(15, partB.length || 1))
      .addOptions(partB)
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('server_rules_customize').setLabel('Add Custom Rules / Notes').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('server_rules_publish_now').setLabel('Refresh Rules Preview Now').setStyle(ButtonStyle.Primary),
  ));
  return rows;
}

function buildRulesLiveEmbed(profile = getProfile()) {
  const selected = _selectedRules(profile);
  const customNote = String(profile.customText || '').trim();
  const chunks = _chunk(selected, 4);
  const embed = new EmbedBuilder()
    .setColor(0x4da3ff)
    .setTitle('📘 Server Rules Preview')
    .setDescription(
      'This is the **base server rules** preview. It is formatted for quick mobile reading so members can understand it without squinting through a text wall.\n\n' +
      `Selected standard rules: **${selected.length}**\n` +
      `Custom notes saved: **${customNote ? 'Yes' : 'No'}**`
    )
    .addFields({
      name: 'How to edit this',
      value: 'Use the two picklists below to turn standard rules on or off. Use **Add Custom Rules / Notes** for server-specific wording or enforcement overrides like `3=warning+boot`.',
    })
    .setTimestamp();

  chunks.slice(0, 5).forEach((group, idx) => {
    embed.addFields({
      name: `Rules ${idx * 4 + 1}-${idx * 4 + group.length}`,
      value: group.map((rule, innerIdx) => _ruleLine(rule, (idx * 4) + innerIdx + 1)).join('\n\n'),
    });
  });

  if (customNote) {
    embed.addFields({
      name: 'Custom notes',
      value: customNote.slice(0, 900),
    });
  }

  return embed;
}

function buildWizardButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('server_rules_customize').setLabel('Customize Server Rules').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('server_rules_publish_now').setLabel('Refresh Rules Preview').setStyle(ButtonStyle.Primary),
  );
}

function buildRulesModal() {
  const modal = new ModalBuilder().setCustomId('server_rules_modal').setTitle('Customize Server Rules');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('rule_numbers').setLabel('Optional rule numbers to enable').setPlaceholder('Optional: 1,2,3,8,12').setStyle(TextInputStyle.Paragraph).setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('overrides').setLabel('Enforcement overrides (optional)').setPlaceholder('Example:\n3=warning+boot\n8=reminder').setStyle(TextInputStyle.Paragraph).setRequired(false),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('custom_text').setLabel('Custom rules or server notes (optional)').setPlaceholder('Optional custom rules, notes, or server-specific language').setStyle(TextInputStyle.Paragraph).setRequired(false),
    ),
  );
  return modal;
}

function parseRuleSelection(numbersRaw, overridesRaw, customText = '') {
  const nums = [...new Set(String(numbersRaw || '').split(/[^0-9]+/).map(x => parseInt(x, 10)).filter(n => n >= 1 && n <= RULE_LIBRARY.length))];
  const overrideMap = {};
  for (const line of String(overridesRaw || '').split(/\n+/)) {
    const m = line.trim().match(/^(\d+)\s*=\s*([a-z+\- ]+)$/i);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    const level = m[2].trim().toLowerCase().replace(/\s+/g, '');
    const normalized = {
      reminder: 'reminder',
      warn: 'warning',
      warning: 'warning',
      high: 'warning+boot',
      severe: 'severe',
      'warning+boot': 'warning+boot',
      warningboot: 'warning+boot',
    }[level] || null;
    if (idx >= 1 && idx <= RULE_LIBRARY.length && normalized) overrideMap[idx] = normalized;
  }
  const selected = nums.map(n => {
    const [id, text, defaultLevel] = RULE_LIBRARY[n - 1];
    return { id, text, level: overrideMap[n] || defaultLevel };
  });
  return { selected, customText: String(customText || '').trim() };
}

module.exports = {
  RULE_LIBRARY,
  ENFORCEMENT_LABELS,
  getProfile,
  saveProfile,
  resetProfile,
  buildServerRulesText,
  publishServerRules,
  buildWizardEmbed,
  buildWizardButtonRow,
  buildRuleSelectRows,
  buildRulesLiveEmbed,
  buildRulesModal,
  parseRuleSelection,
  listRulesText,
};
