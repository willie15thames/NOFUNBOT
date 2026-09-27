/* Boot recovery for provider control-plane state. Safe to run repeatedly. */
'use strict';
async function recover(logger=console){
  const connectionHydration=await require('./providerConnectionService').hydrateFromDatabase().catch(e=>({ok:false,hydrated:0,reason:e.message}));
  const syncRunHydration=await require('./providerSyncRunService').hydrateFromDatabase?.().catch(e=>({ok:false,hydrated:0,reason:e.message})) || {ok:true,hydrated:0};
  const interrupted=await require('./providerSyncRunService').recoverInterruptedDurable?.() || require('./providerSyncRunService').recoverInterrupted();
  const sync=require('./leagueSyncService');
  const companion=await sync.processQueuedImports('companion_export').catch(e=>({ok:false,reason:e.message}));
  const neon=await sync.processQueuedImports('neonsportz').catch(e=>({ok:false,reason:e.message}));
  logger?.info?.(`Provider recovery complete: connections=${connectionHydration.hydrated||0} syncRuns=${syncRunHydration.hydrated||0} interrupted=${interrupted} companion=${companion.processed||0} neon=${neon.processed||0}`);
  return {connectionHydration,syncRunHydration,interrupted,companion,neon};
}
module.exports={recover};
