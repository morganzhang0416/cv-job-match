/** Common English words. They never count as keywords. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both
  but by can could did do does doing down during each few for from further had has have having he her here hers him his
  how i if in into is it its just like may me might more most must my no nor not now of off on once one only or other
  our ours out over own same shall she should so some such than that the their theirs them then there these they this
  those through to too under until up us very was we were what when where which while who whom why will with within
  without would you your yours yourself yourselves per via etc eg ie vs`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Words that fill job descriptions but say nothing about skills.
 * Phrases that contain one of these words are not offered as keywords.
 */
export const FILLER: ReadonlySet<string> = new Set(
  `ability able about across active additional apply applicant applicants application applications area areas aspect
  aspects background based benefit benefits best bring building candidate candidates career careers clear close closely
  company complex concept concepts continue contribute core culture current daily day days deliver delivering
  demonstrated demonstrate described desire desired develop developing different directly diverse drive driven dynamic
  effective effectively employer employees employee encouraged end ensure ensuring environment environments equal
  essential every excellent exciting experience experienced experiences exposure familiar familiarity fast field first
  following form forward full future general get getting give global go goal goals good great group grow growing growth
  hands help helping high highly ideal impact important improve including include includes individual individuals
  industry initiative innovative interest interested join joining key large last latest lead leading learn level levels
  life line little long look looking love make making manage many meet meeting member members mission modern month
  months much multiple need needs needed new next number offer offers one open opportunities opportunity order
  organisation organization others own part partner partners passion passionate people person place plan please plus
  point position positions possible practical present primary prior proven provide providing quickly range real
  reasonable recent related relevant remote report required requirement requirements responsibilities responsibility
  responsible result results role roles salary scope second see seek seeking senior set several share show similar
  simple single size skill skilled skills small solid solution solutions some specific start state step steps strong
  success successful suitable support sure take taking tasks team teams tech thing things think third time today
  together tools top track type understand understanding unique use used using value values variety various view want
  way ways week weeks well whole wide work worked working works world year years yes`
    .split(/\s+/)
    .filter(Boolean),
);
