// 常规停用词表：挖空/关键词判定时默认排除的高频虚词。
// 注意：there/their/its/than/then/to/too/off 明知是产品要抓的重灾区，
// 仍然故意留在这张表里——它们首先是高频虚词，普适规则不能因为个别用法
// 就把整类词从停用词里摘掉，否则会把大量正常挖空判成关键词。
// 真正要抓这几个词的场景，靠同音/易混词表（homophones.ts）单独打补丁，
// 两张表必须一起看：这张表负责"通常不考"，那张表负责"这几个例外，考"。
export const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','then','than','so','because',
  'as','of','at','by','for','with','about','against','between','into',
  'through','during','before','after','above','below','to','from','up',
  'down','in','out','on','off','over','under','again','further','once',
  'here','there','when','where','why','how','all','any','both','each',
  'few','more','most','other','some','such','no','nor','not','only',
  'own','same','too','very','can','will','just','should','now',
  'i','me','my','myself','we','our','ours','ourselves','you','your',
  'yours','he','him','his','she','her','hers','it','its','they','them',
  'their','theirs','what','which','who','whom','this','that','these',
  'those','am','is','are','was','were','be','been','being','have','has',
  'had','having','do','does','did','doing','would','could','ought',
])
