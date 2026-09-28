/*
 * Central speech gate for conversational AI personas.
 * A direct @mention OR a Discord reply to the bot is an explicit invocation.
 * This lets several humans participate in one bot conversation without forcing
 * every follow-up to repeat the @mention.
 */
'use strict';
function isReplyToBot(message, client){
  if(!message || !client?.user?.id) return false;
  if(message.mentions?.repliedUser?.id === client.user.id) return true;
  const refId = message.reference?.messageId;
  if(!refId) return false;
  const cached = message.channel?.messages?.cache?.get?.(refId);
  return cached?.author?.id === client.user.id;
}
function isExplicitBotMention(message, client){
  if(!message || !client?.user?.id) return false;
  if(message.author?.bot || !message.guild) return false;
  return !!message.mentions?.users?.has?.(client.user.id) || isReplyToBot(message, client);
}
module.exports={isExplicitBotMention,isReplyToBot};
