import { readFileSync, writeFileSync } from "node:fs";

const words = JSON.parse(readFileSync(new URL("../public/weekly-vocabulary.json", import.meta.url), "utf8"));

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/\s*[—–―]\s*[^.!?]*$/, "").trim();
}
function containsTerm(sentence, term) {
  const alternatives = term.toLowerCase().split(/\s*\/\s*/).map((item) => item.trim());
  const lower = sentence.toLowerCase();
  return alternatives.some((item) => {
    if (!item) return false;
    if (item.includes(" ")) return lower.includes(item);
    return lower.split(/[^a-z'-]+/).includes(item);
  });
}
async function dictionaryExample(term) {
  const lookup = term.split(/\s*\/\s*/)[0].trim();
  if (lookup.includes(" ") || !/^[a-z'-]+$/i.test(lookup)) return "";
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lookup)}`);
    if (!response.ok) return "";
    const entries = await response.json();
    const candidates = entries.flatMap((entry) => (entry.meanings || []).flatMap((meaning) => (meaning.definitions || []).map((definition) => clean(definition.example))));
    return candidates.find((sentence) => sentence && containsTerm(sentence, lookup) && sentence.split(/\s+/).length >= 5 && sentence.split(/\s+/).length <= 24) || "";
  } catch { return ""; }
}
async function translate(text) {
  try {
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`);
    if (!response.ok) return "";
    const data = await response.json();
    return (data?.[0] || []).map((part) => part?.[0] || "").join("").trim();
  } catch { return ""; }
}

// Các mục khó, cụm IELTS và từ có nhiều nghĩa cần câu được khóa đúng ngữ cảnh.
const curated = {
  rescue: "Firefighters rescued two children from the burning house.",
  unique: "Each fingerprint has a unique pattern.",
  flew: "A flock of birds flew over the lake at sunset.",
  bat: "A bat flew out of the cave after dark.",
  pace: "She walked at a steady pace to conserve her energy.",
  whip: "The strong wind whipped the flags above the stadium.",
  crank: "Turn the crank slowly to raise the bucket from the well.",
  invanted: "The telephone was invented in the nineteenth century.",
  carries: "This bridge carries heavy traffic during rush hour.",
  "even the most studious among": "Even the most studious among us found the final exam difficult.",
  skim: "Skim the article first to understand its main idea.",
  scan: "Scan the timetable for the next train to London.",
  patient: "You need to be patient when learning a new language.",
  marks: "She received high marks in all her science subjects.",
  stems: "Remove the stems before putting the strawberries in the pot.",
  stones: "Take the stones out of the peaches before cooking them.",
  over: "The meeting was over before lunchtime.",
  pectin: "Apples contain pectin, which helps jam become firm.",
  "poured into jars": "The hot jam was poured into jars and left to cool.",
  lids: "Tighten the lids while the jars are still warm.",
  "discussing a course assignment": "The students were discussing a course assignment in the library.",
  born: "She was born in a small coastal town.",
  instance: "For instance, cycling can reduce traffic congestion.",
  according: "According to the report, air pollution has fallen.",
  "stringhopper press": "The dough is pushed through a Stringhopper press to form thin noodles.",
  book: "We should book our train tickets before the holiday.",
  "gift wrapping": "The shop offers free gift wrapping in December.",
  "music taste": "My brother and I have very different music tastes.",
  "in common": "Although we grew up apart, we have a lot in common.",
  accommodating: "The hotel staff were accommodating when we changed our booking.",
  "grinder into flour": "The dried grains are put into a grinder and turned into flour.",
  "take achievement": "Students take pride in their academic achievements.",
  "coherence & cohesion": "Clear topic sentences improve coherence and cohesion in an essay.",
  "lexical resource": "Using precise collocations can improve your lexical resource score.",
  "grammatical range": "The essay demonstrates a wide grammatical range with few errors.",
  "demonstrate / show / illustrate": "The graph illustrates a sharp increase in household spending.",
  "involves a range of stages": "The production process involves a range of stages from harvesting to packaging.",
  "physical resemblance": "There is a strong physical resemblance between the twins.",
  "sibling rivalry": "Sibling rivalry can become stronger when children compete for attention.",
  "stable upbringing": "A stable upbringing can give children a sense of security.",
  "maternal instinct": "Her maternal instinct made her immediately protect the frightened child.",
  "parental grandmother": "My paternal grandmother taught me how to make this traditional dish.",
  "handed down": "This recipe has been handed down through four generations.",
  makeover: "The old apartment received a complete makeover before it was rented.",
  "fancy gala": "She wore an elegant black dress to the fancy gala.",
  "had worn": "He realized that he had worn the same jacket to both events.",
  instead: "We stayed home instead of going out in the rain.",
  paired: "She paired a white shirt with dark trousers.",
  "crisp white": "He chose a crisp white shirt for the interview.",
  "wrap scarf": "Wrap the scarf around your neck before going outside.",
  "leather gloves": "Leather gloves kept his hands warm on the motorcycle.",
  swap: "I swapped my formal shoes for a comfortable pair.",
  even: "Even a small change can make the room look brighter."
  ,community: "The local community raised money to rebuild the playground."
  ,deforestation: "Deforestation destroys wildlife habitats and increases carbon emissions."
  ,awoke: "She awoke to the sound of heavy rain on the roof."
  ,"missing out": "He regretted missing out on the chance to study abroad."
  ,proverb: "My grandmother often quotes a proverb about patience."
  ,selfish: "It was selfish of him to take all the food for himself."
  ,scientific: "The researchers found no scientific evidence to support the claim."
  ,maintain: "Regular exercise helps maintain a healthy body weight."
  ,explosion: "The explosion shattered several windows near the factory."
  ,responsibilities: "Parents have responsibilities for their children's safety and education."
  ,geographically: "The two villages are geographically close but culturally different."
  ,chances: "Good qualifications can improve your chances of finding a job."
  ,"open-minded": "An open-minded person is willing to consider different opinions."
  ,backgrounds: "Students from different backgrounds worked together on the project."
  ,"similar interests": "We became friends because we shared similar interests."
  ,opinions: "People expressed different opinions during the public meeting."
  ,"express my ideas": "Writing regularly helps me express my ideas more clearly."
  ,"definitely true though": "The task was difficult; that is definitely true, though."
  ,helpful: "The librarian gave me helpful advice about finding reliable sources."
  ,"unforgettable memories": "The family trip created unforgettable memories for the children."
  ,"physical state": "Water changes its physical state when it freezes."
  ,celebration: "The whole family gathered for her birthday celebration."
  ,equipment: "All safety equipment must be checked before the experiment."
  ,"light material": "The tent is made from a light material that dries quickly."
  ,"heavy metal": "The laboratory detected a heavy metal in the river water."
  ,subway: "I take the subway to work when the roads are crowded."
  ,kite: "The children flew a kite in the strong sea breeze."
  ,housewife: "The housewife started an online business from her kitchen."
  ,colleagues: "My colleagues helped me finish the report before the deadline."
  ,"good fortune": "His business success was partly due to good fortune."
  ,"good luck": "She wished me good luck before the interview."
  ,established: "The university was established more than a century ago."
  ,"relate to": "Many young people can relate to the character's struggle."
  ,nurture: "Parents should nurture their children's curiosity and confidence."
  ,"in relation to": "The graph shows population growth in relation to housing demand."
  ,"large holes": "Workers drilled large holes in the metal sheet."
  ,"narrower base": "The container has a narrower base to help it stand securely."
  ,steamer: "Place the dumplings in the steamer for ten minutes."
  ,ragged: "The lost hiker returned in ragged clothes after three days."
  ,hatred: "Years of conflict created deep hatred between the two groups."
  ,"after that": "Mix the flour with water; after that, knead the dough."
  ,omelette: "She made an omelette with eggs, mushrooms, and fresh herbs."
  ,"fresh ingredients": "The restaurant buys fresh ingredients from local farmers."
  ,"immediate family": "Only immediate family members attended the private ceremony."
  ,"family gatherings": "Our family gatherings usually take place at my grandparents' house."
  ,"active role": "Fathers are taking a more active role in childcare."
  ,"extended family": "Her extended family includes several aunts, uncles, and cousins."
  ,"family resemblance": "The family resemblance is especially clear in their smiles."
  ,"striking resemblance": "There is a striking resemblance between the actress and her mother."
  ,"nuclear family": "A nuclear family normally consists of parents and their children."
  ,chaotic: "The airport became chaotic after dozens of flights were cancelled."
  ,"family tie": "Living abroad did not weaken his family ties."
  ,"maternal grandmother": "My maternal grandmother looked after me while my mother worked."
  ,"caring and supportive": "Her parents were caring and supportive throughout her studies."
  ,similar: "The two proposals are similar in cost but different in design."
  ,temperament: "The child has a calm temperament and rarely becomes upset."
  ,hurried: "He gave a hurried goodbye and ran to catch the train."
  ,elegant: "The hotel lobby has an elegant design with marble floors."
  ,bubbles: "Small bubbles rose to the surface of the boiling water."
  ,edge: "She placed the cup near the edge of the table."
  ,flourish: "Small businesses can flourish when the local economy is stable."
  ,value: "Many employers value practical experience as much as qualifications."
  ,handled: "The customer service team handled the complaint professionally."
  ,mixture: "Stir the mixture until the sugar has completely dissolved."
  ,closer: "As the boat moved closer, we could see the people on deck."
  ,passage: "Read the passage carefully before answering the questions."
  ,culture: "Food is an important part of a country's culture."
  ,positive: "Regular exercise has a positive effect on mental health."
  ,discover: "Scientists hope to discover a more effective treatment for the disease."
  ,resident: "Every resident received a notice about the new parking rules."
  ,confident: "She felt confident enough to speak in front of the class."
  ,mental: "Long working hours can damage employees' mental health."
  ,round: "They sat around a round table during the discussion."
  ,square: "The children drew a large square on the pavement."
  ,rewarding: "Teaching young children can be difficult but highly rewarding."
  ,interaction: "Face-to-face interaction helps team members build trust."
  ,shake: "Shake the bottle well before taking the medicine."
  ,pick: "Pick the ripe tomatoes and leave the green ones on the plant."
  ,wicked: "The wicked king treated his people cruelly."
  ,crooked: "The old fence was crooked after the storm."
  ,alike: "The twins look alike, but their personalities are different."
  ,casual: "The office allows employees to wear casual clothes on Fridays."
  ,sparkling: "She wore a sparkling necklace to the evening reception."
  ,kindness: "A small act of kindness can make a difficult day easier."
  ,blink: "Blink several times if your eyes feel dry."
  ,threaten: "Rising sea levels threaten many coastal communities."
};

function fallback(term, meaning, index) {
  const t = term;
  const patterns = [
    `The report uses “${t}” to describe an important change.`,
    `Our teacher explained “${t}” with a practical example.`,
    `The article shows how “${t}” affects everyday life.`,
    `We discussed “${t}” during today’s lesson.`,
  ];
  // These are last-resort sentences; most single words receive dictionary examples.
  return patterns[index % patterns.length];
}

const output = {};
for (const [index, word] of words.entries()) {
  const key = word.term.trim().toLowerCase();
  const english = curated[key] || await dictionaryExample(word.term) || fallback(word.term, word.meaning, index);
  const vietnamese = await translate(english) || `Ví dụ ngữ cảnh cho “${word.meaning}”.`;
  output[key] = [english, vietnamese];
  if ((index + 1) % 20 === 0) console.log(`${index + 1}/${words.length}`);
}

writeFileSync(new URL("../public/weekly-examples.json", import.meta.url), JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${Object.keys(output).length} weekly examples.`);
