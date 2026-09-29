/* Button-first replacement for bot-rendered select menus. */
'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const componentSessions = require('./componentSessionService');

function _button(sessionId, action, key, label, style = ButtonStyle.Secondary, disabled = false, emoji = null) {
  const b = new ButtonBuilder()
    .setCustomId(`ui:${sessionId}:${action}${key != null ? `:${key}` : ''}`)
    .setLabel(String(label || 'Option').slice(0,80))
    .setStyle(style)
    .setDisabled(!!disabled);
  if (emoji) {
    try { b.setEmoji(emoji); } catch {}
  }
  return b;
}

function renderSession(session, userId = null) {
  if (!session) return [];
  const selected = componentSessions.selectionFor(session, userId);
  const start = session.page * session.pageSize;
  const visible = session.options.slice(start, start + session.pageSize);
  const rows = [];
  for (let i = 0; i < visible.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const opt of visible.slice(i, i + 5)) {
      row.addComponents(_button(
        session.id,
        'pick',
        opt.key,
        opt.label,
        selected.has(opt.key) ? ButtonStyle.Success : ButtonStyle.Secondary,
        opt.disabled,
        opt.emoji,
      ));
    }
    rows.push(row);
  }
  const pages = Math.max(1, Math.ceil(session.options.length / session.pageSize));
  const nav = new ActionRowBuilder();
  if (pages > 1) {
    nav.addComponents(
      _button(session.id, 'prev', null, '◀ Prev', ButtonStyle.Secondary, session.page <= 0),
      _button(session.id, 'page', null, `${session.page + 1}/${pages}`, ButtonStyle.Secondary, true),
      _button(session.id, 'next', null, 'Next ▶', ButtonStyle.Secondary, session.page >= pages - 1),
    );
  }
  if (session.maxValues > 1 || session.minValues === 0) {
    nav.addComponents(_button(session.id, 'done', null, 'Done', ButtonStyle.Primary, false));
  }
  if (nav.components.length) rows.push(nav);
  return rows.slice(0, 5);
}

function createChoiceRows(input = {}) {
  const session = componentSessions.create(input);
  return { session, rows: renderSession(session, input.actorId || null) };
}


function createChoiceLauncher(input = {}) {
  const session = componentSessions.create(input);
  const button = new ButtonBuilder()
    .setCustomId(`uiopen:${session.id}`)
    .setLabel(String(input.launchLabel || input.label || 'Choose options').slice(0,80))
    .setStyle(input.launchStyle || ButtonStyle.Secondary)
    .setDisabled(!!input.disabled);
  if (input.launchEmoji) { try { button.setEmoji(input.launchEmoji); } catch {} }
  return { session, button, row:new ActionRowBuilder().addComponents(button) };
}

module.exports = { createChoiceRows, createChoiceLauncher, renderSession };
