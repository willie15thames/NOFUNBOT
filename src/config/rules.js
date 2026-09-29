/*
 * NAVIGATION HEADER
 * FILE: src/config/rules.js
 * LAYER: Configuration layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

'use strict';

const SERVER_RULE_TEXT = `# 🎉 CommishAI Server Rules

## Keep it fun
• Trash talk is allowed. This server is not church. People are going to talk shit.
• No slurs, hate speech, real-life threats, doxxing, or harassment campaigns.
• Don't spam, scam, or flood channels with nonsense.
• Use the right channels for the right thing. Don't turn #rules into a food court.
• If staff tells you to move, cool it, or stop, listen.

## Keep it playable
• Don't impersonate staff or the bot.
• Don't bait people into bannable behavior then play dumb.
• Screenshots, trade posts, scores, and scheduling should go where they belong.

## Bottom line
Talk your shit. Have fun. Don't be hateful, don't be weird, and don't ruin the server.`;

const LEAGUE_RULE_PRESETS = {
  competitive_default: {
    label: 'Competitive Default',
    text: `# 🏈 Competitive League Rules

## Gameplay Settings
• 4 minute quarters • Difficulty: All-Madden • Gameplay style: Competitive

## Scheduling
• 48 hour advances unless all games finish earlier
• Both users must communicate within 24 hours of advance
• One silent after 24 hours = force loss. Both silent = fair sim.

## Streaming
• Mandatory for Primetime, Overseas, and GOTW
• 8 streams = Superstar dev trait upgrade
• 16 streams = Dev Upgrade or Age Reset
• Every stream = +2 non-physical attribute boost
• Stream must be posted in #livestreams before halftime

## Trades
• All user trades go through /propose-trade — commissioner reviews
• CPU trades need a full green bar
• Commissioner has final say

## Discipline
• 3 gameplay warnings = force loss
• 3 close-app warnings = removal
• 3 inactivity warnings = removal
• Cheating = automatic force loss

## Awards
• POTW winners earn +2 non-physical attribute points
• Yearly award winners receive a Dev Trait upgrade or Age Reset
• No boosts to speed, acceleration, agility, strength, jumping, stamina, toughness, or injury`
  },
  sim: {
    label: 'Sim League',
    text: `# 🎲 Sim League Rules

## Gameplay Style
• Realistic play calling and situational football only
• No glitch exploitation or broken mechanics abuse
• Respect sim pacing and clock management

## Scheduling
• 48 hour advances unless all games finish earlier
• Both users must communicate within 24 hours of advance
• One silent after 24 hours = force loss. Both silent = fair sim.

## Trades
• All user trades require commissioner approval
• CPU trades need a full green bar

## Discipline
• 3 gameplay warnings = force loss
• 3 close-app warnings = removal
• 3 inactivity warnings = removal
• Cheating = automatic force loss`
  },
  custom_proam: {
    label: 'Custom / Pro-Am',
    text: `# 🏆 Custom League Rules

## Structure
• This is a bot-managed custom league
• Team identities, standings, schedules, and playoff tracking run through CommishAI

## Scheduling
• 48 hour game windows unless staff changes the timer
• Use your game channels to coordinate

## Teams
• Custom/imported teams must keep a clear replacement slot or identity mapping
• Team names and logos must stay readable for standings and scoreboards

## Discipline
• Trash talk is fine. Being hateful or cheating is not.`
  }
};

const DEFAULT_RULE_TEXT = LEAGUE_RULE_PRESETS.competitive_default.text;

module.exports = { DEFAULT_RULE_TEXT, SERVER_RULE_TEXT, LEAGUE_RULE_PRESETS };
