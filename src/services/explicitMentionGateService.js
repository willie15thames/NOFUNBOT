/*
 * Central speech gate for conversational AI personas.
 * Passive observation may collect bounded local context, but conversational handlers may speak only when
 * Discord resolved an explicit mention of the current bot user. Slash commands/buttons/system jobs bypass this
 * service because they are already explicit invocation paths.
 */
'use strict';
function isExplicitBotMention(message, client){
  if(!message || !client?.user?.id) return false;
  if(message.author?.bot || !message.guild) return false;
  return !!message.mentions?.users?.has?.(client.user.id);
}
module.exports={isExplicitBotMention};
