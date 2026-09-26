/*
 * NAVIGATION HEADER
 * FILE: src/config/teams.js
 * LAYER: Configuration layer
 * PURPOSE: Supports this part of the system; review exported functions/classes below for the exact execution path.
 * LOOK HERE FIRST WHEN DEBUGGING: Search this file for exported functions, top-level listeners, and state writes.
 * RELATED FLOW: See nearby files in the same folder for related behavior.
 * NOTE: Keep comments in sync when adding new processes, handlers, or state transitions.
 */

// src/config/teams.js — all static team data
const DEFAULT_OPEN_TEAMS = [
  { baseTeam:'Bills',      displayTeam:'Buffalo Bills',        logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Dolphins',   displayTeam:'Miami Dolphins',       logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Patriots',   displayTeam:'New England Patriots', logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Jets',       displayTeam:'New York Jets',        logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Ravens',     displayTeam:'Baltimore Ravens',     logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Bengals',    displayTeam:'Cincinnati Bengals',   logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Browns',     displayTeam:'Cleveland Browns',     logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Steelers',   displayTeam:'Pittsburgh Steelers',  logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Texans',     displayTeam:'Houston Texans',       logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Colts',      displayTeam:'Indianapolis Colts',   logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Jaguars',    displayTeam:'Jacksonville Jaguars', logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Titans',     displayTeam:'Tennessee Titans',     logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Chiefs',     displayTeam:'Kansas City Chiefs',   logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Raiders',    displayTeam:'Las Vegas Raiders',    logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Chargers',   displayTeam:'Los Angeles Chargers', logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Broncos',    displayTeam:'Denver Broncos',       logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Cowboys',    displayTeam:'Dallas Cowboys',       logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Eagles',     displayTeam:'Philadelphia Eagles',  logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Giants',     displayTeam:'New York Giants',      logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Commanders', displayTeam:'Washington Commanders',logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Bears',      displayTeam:'Chicago Bears',        logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Lions',      displayTeam:'Detroit Lions',        logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Packers',    displayTeam:'Green Bay Packers',    logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Vikings',    displayTeam:'Minnesota Vikings',    logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Falcons',    displayTeam:'Atlanta Falcons',      logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Panthers',   displayTeam:'Carolina Panthers',    logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Saints',     displayTeam:'New Orleans Saints',   logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Buccaneers', displayTeam:'Tampa Bay Buccaneers', logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'49ers',      displayTeam:'San Francisco 49ers',  logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Seahawks',   displayTeam:'Seattle Seahawks',     logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Rams',       displayTeam:'Los Angeles Rams',     logoUrl:null,isOpen:true,ownerId:null },
  { baseTeam:'Cardinals',  displayTeam:'Arizona Cardinals',    logoUrl:null,isOpen:true,ownerId:null },
];

const DIVISIONS = [
  { label:'AFC East',  teams:['Bills','Dolphins','Patriots','Jets'] },
  { label:'AFC North', teams:['Ravens','Bengals','Browns','Steelers'] },
  { label:'AFC South', teams:['Texans','Colts','Jaguars','Titans'] },
  { label:'AFC West',  teams:['Chiefs','Raiders','Chargers','Broncos'] },
  { label:'NFC East',  teams:['Cowboys','Eagles','Giants','Commanders'] },
  { label:'NFC North', teams:['Bears','Lions','Packers','Vikings'] },
  { label:'NFC South', teams:['Falcons','Panthers','Saints','Buccaneers'] },
  { label:'NFC West',  teams:['49ers','Seahawks','Rams','Cardinals'] },
];

const TEAM_EMOJI_MAP = {
  'ravens':'ravens','browns':'browns','eagles':'eagles','colts':'colts',
  'texans':'texans','lions':'lions','49ers':'49ers','broncos':'broncos',
  'dolphins':'dolphins','packers':'packers','cardinals':'cardinals','vikings':'vikings',
  'raiders':'raiders','seahawks':'seahawks','patriots':'patriots','rams':'rams',
  'buccaneers':'buccaneers','commanders':'commanders','bills':'bills','jets':'jets',
  'falcons':'falcons','titans':'titans','chiefs':'chiefs','bengals':'bengals',
  'jaguars':'3023jaguars','panthers':'1804panthers','cowboys':'cowboys',
  'bears':'chicagobears','chicago bears':'chicagobears','saints':'saints',
  'chargers':'chargers','steelers':'steelers','giants':'giants',
  '_star':'stardev','_superstar':'Superstar','_xfactor':'Xfactor',
};

const TEAM_SLANG = {
  'duval':'Jaguars','big cat':'Jaguars','jags':'Jaguars',
  'steel curtain':'Steelers','terrible towel':'Steelers','stillers':'Steelers',
  "america's team":'Cowboys','dem boys':'Cowboys','big d':'Cowboys',
  'philly':'Eagles','iggles':'Eagles','kingdom':'Chiefs','kc':'Chiefs',
  'murder birds':'Ravens','bmore':'Ravens','dawg pound':'Browns',
  'pats':'Patriots','mafia':'Bills','bills mafia':'Bills',
  'fins':'Dolphins','finheads':'Dolphins','gang green':'Jets',
  'who dey':'Bengals','horseshoe':'Colts',
  'silver and black':'Raiders','black hole':'Raiders','raider nation':'Raiders',
  'bolts':'Chargers','powder blues':'Chargers',
  'mile high':'Broncos','orange crush':'Broncos',
  'httr':'Commanders','wft':'Commanders','big blue':'Giants',
  'da bears':'Bears','pride':'Lions',
  'cheeseheads':'Packers','titletown':'Packers','go pack go':'Packers',
  'skol':'Vikings','rise up':'Falcons','dirty birds':'Falcons',
  'keep pounding':'Panthers','who dat':'Saints','nawlins':'Saints',
  'bucs':'Buccaneers',
  'niners':'49ers','faithful':'49ers','gold rush':'49ers','frisco':'49ers',
  'hawks':'Seahawks','12s':'Seahawks','la rams':'Rams','cards':'Cardinals',
  'bull pen':'Texans',
};

const ATTRS_BY_CATEGORY = {
  throw_acc:  [{abbr:'SAC',full:'Short Throw Accuracy'},{abbr:'MAC',full:'Mid Throw Accuracy'},{abbr:'DAC',full:'Deep Throw Accuracy'},{abbr:'TOR',full:'Throw on the Run'},{abbr:'TUP',full:'Throw Under Pressure'}],
  awareness:  [{abbr:'AWR',full:'Awareness'},{abbr:'PRC',full:'Play Recognition'},{abbr:'PUR',full:'Pursuit'},{abbr:'BSK',full:'Break Sack'}],
  route:      [{abbr:'SRR',full:'Short Route Running'},{abbr:'MRR',full:'Medium Route Running'},{abbr:'DRR',full:'Deep Route Running'},{abbr:'REL',full:'Release'}],
  catching:   [{abbr:'CTH',full:'Catching'},{abbr:'CIT',full:'Catch in Traffic'},{abbr:'SPC',full:'Spectacular Catch'}],
  ballcarrier:[{abbr:'TRK',full:'Trucking'},{abbr:'BTK',full:'Break Tackle'},{abbr:'STA',full:'Stiff Arm'},{abbr:'SPM',full:'Spin Move'},{abbr:'JKM',full:'Juke Move'},{abbr:'CAR',full:'Carrying'},{abbr:'COD',full:'Change of Direction'},{abbr:'ELU',full:'Elusiveness'}],
  blocking:   [{abbr:'RBK',full:'Run Block'},{abbr:'PBK',full:'Pass Block'},{abbr:'IBK',full:'Impact Blocking'},{abbr:'RBP',full:'Run Block Power'},{abbr:'RBF',full:'Run Block Footwork'},{abbr:'PBP',full:'Pass Block Power'},{abbr:'PBF',full:'Pass Block Footwork'},{abbr:'LBK',full:'Lead Block'}],
  passrush:   [{abbr:'BSH',full:'Block Shedding'},{abbr:'PWM',full:'Power Moves'},{abbr:'FNM',full:'Finesse Moves'},{abbr:'HTP',full:'Hit Power'},{abbr:'TAK',full:'Tackle'},{abbr:'PUR',full:'Pursuit'}],
  coverage:   [{abbr:'MCV',full:'Man Coverage'},{abbr:'ZCV',full:'Zone Coverage'},{abbr:'PRS',full:'Press'},{abbr:'CIT',full:'Catch in Traffic'},{abbr:'PRC',full:'Play Recognition'}],
  kicking:    [{abbr:'KPW',full:'Kick Power'},{abbr:'KAC',full:'Kick Accuracy'}],
  throw_pow:  [{abbr:'THP',full:'Throw Power'}],
  play_action:[{abbr:'PAC',full:'Play Action'}],
  hit_power:  [{abbr:'HTP',full:'Hit Power'}],
  tackle:     [{abbr:'TAK',full:'Tackle'}],
};

module.exports = { DEFAULT_OPEN_TEAMS, DIVISIONS, TEAM_EMOJI_MAP, TEAM_SLANG, ATTRS_BY_CATEGORY };
