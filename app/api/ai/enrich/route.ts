import { NextResponse } from "next/server";
import ieltsAreaData from "../../../../lib/ielts-areas.json";
import { topicalWords } from "../../../../lib/topical-words.mjs";

type DictionaryEntry = { word?:string; phonetic?:string; phonetics?:{text?:string}[]; meanings?:{partOfSpeech?:string;synonyms?:string[];antonyms?:string[];definitions?:{definition?:string;example?:string;synonyms?:string[];antonyms?:string[]}[]}[] };
type DatamuseEntry = {word?:string;tags?:string[];defs?:string[]};

const verifiedVietnamese:Record<string,string>={
  comfortable:"thoải mái; dễ chịu",
  uncomfortable:"không thoải mái; khó chịu",
};

// Cụm từ đời thường được ưu tiên hơn câu trích từ điển. Một từ nên được học cùng
// những từ thường đứng cạnh nó để người học có thể dùng ngay trong câu thật.
const practicalPhrases:Record<string,{phrase:string;meaning:string;example:string;exampleVi:string}>={
  weed:{phrase:"pull out weeds",meaning:"nhổ cỏ dại",example:"I need to pull out the weeds in the garden.",exampleVi:"Tôi cần nhổ cỏ dại trong vườn."},
  weeds:{phrase:"pull out weeds",meaning:"nhổ cỏ dại",example:"I need to pull out the weeds in the garden.",exampleVi:"Tôi cần nhổ cỏ dại trong vườn."},
  decision:{phrase:"make a decision",meaning:"đưa ra quyết định",example:"We need to make a decision today.",exampleVi:"Hôm nay chúng ta cần đưa ra quyết định."},
  break:{phrase:"take a break",meaning:"nghỉ giải lao",example:"Let's take a short break after this lesson.",exampleVi:"Hãy nghỉ một lát sau bài học này."},
  attention:{phrase:"pay attention to",meaning:"chú ý đến",example:"Please pay attention to the road.",exampleVi:"Hãy chú ý đến đường đi."},
  mistake:{phrase:"make a mistake",meaning:"phạm lỗi",example:"It is okay to make a mistake while learning.",exampleVi:"Phạm lỗi trong khi học cũng không sao."},
  shower:{phrase:"take a shower",meaning:"đi tắm",example:"I take a shower before breakfast.",exampleVi:"Tôi tắm trước bữa sáng."},
  homework:{phrase:"do homework",meaning:"làm bài tập về nhà",example:"I do my homework after dinner.",exampleVi:"Tôi làm bài tập về nhà sau bữa tối."},
  photo:{phrase:"take a photo",meaning:"chụp ảnh",example:"Can you take a photo of us?",exampleVi:"Bạn có thể chụp cho chúng tôi một tấm ảnh không?"},
  progress:{phrase:"make progress",meaning:"tiến bộ",example:"You will make progress if you practise every day.",exampleVi:"Bạn sẽ tiến bộ nếu luyện tập mỗi ngày."},
  rescue:{phrase:"carry out a rescue mission",meaning:"thực hiện một nhiệm vụ giải cứu",example:"The team carried out a rescue mission during the storm.",exampleVi:"Đội đã thực hiện một nhiệm vụ giải cứu trong cơn bão."},
  insect:{phrase:"protect crops from insects",meaning:"bảo vệ mùa màng khỏi côn trùng",example:"Farmers use nets to protect crops from insects.",exampleVi:"Nông dân dùng lưới để bảo vệ mùa màng khỏi côn trùng."},
  insects:{phrase:"protect crops from insects",meaning:"bảo vệ mùa màng khỏi côn trùng",example:"Farmers use nets to protect crops from insects.",exampleVi:"Nông dân dùng lưới để bảo vệ mùa màng khỏi côn trùng."},
  problem:{phrase:"deal with a problem",meaning:"xử lý một vấn đề",example:"We need to deal with this problem today.",exampleVi:"Hôm nay chúng ta cần xử lý vấn đề này."},
  opportunity:{phrase:"take advantage of an opportunity",meaning:"tận dụng một cơ hội",example:"You should take advantage of this opportunity to practise.",exampleVi:"Bạn nên tận dụng cơ hội này để luyện tập."},
  responsibility:{phrase:"take responsibility for",meaning:"chịu trách nhiệm về",example:"We must take responsibility for our decisions.",exampleVi:"Chúng ta phải chịu trách nhiệm về các quyết định của mình."},
  effort:{phrase:"make an effort to",meaning:"nỗ lực để làm gì",example:"I make an effort to speak English every day.",exampleVi:"Tôi cố gắng nói tiếng Anh mỗi ngày."},
  habit:{phrase:"develop a habit of",meaning:"hình thành thói quen",example:"She developed a habit of reading before bed.",exampleVi:"Cô ấy hình thành thói quen đọc sách trước khi ngủ."},
  effect:{phrase:"have an effect on",meaning:"có ảnh hưởng đến",example:"Sleep has a strong effect on your memory.",exampleVi:"Giấc ngủ có ảnh hưởng lớn đến trí nhớ của bạn."},
};

// Nguồn dự phòng dùng cấu trúc có thể tái sử dụng trong giao tiếp, không coi mạo từ,
// "many" hay "very" là collocation. Người học nhận thêm một khung câu có giá trị.
function generatedPhraseFor(word:string,partOfSpeech:string) {
  const part=partOfSpeech.toLowerCase();
  const plural=/s$/.test(word)&&!/(ss|us|is)$/.test(word);
  if(part.includes("verb")) return {phrase:`learn how to ${word}`,example:`I am learning how to ${word} in real situations.`};
  if(part.includes("adjective")) return {phrase:`feel ${word} about`,example:`I feel ${word} about the decision we made.`};
  if(part.includes("adverb")) return {phrase:`communicate ${word}`,example:`It is important to communicate ${word} at work.`};
  if(plural) return {phrase:`deal with ${word}`,example:`We need a better way to deal with ${word}.`};
  return {phrase:`the importance of ${word}`,example:`We talked about the importance of ${word} in daily life.`};
}

function topicFor(term:string, definition:string, meaning:string) {
  const text=`${term} ${definition} ${meaning}`.toLowerCase();
  const groups:[string,string[]][]=[
    ["Công nghệ",["computer","software","data","digital","internet","program","system","device","code"]],
    ["Cảm xúc",["feel","emotion","happy","sad","angry","fear","love","kind","mood"]],
    ["Động vật",["animal","bird","mammal","fish","insect","creature"]],
    ["Khoa học",["science","chemical","physical","energy","research","invent","biology"]],
    ["Công việc",["work","business","company","manage","office","career","project"]],
    ["Giao tiếp",["speak","say","talk","communicate","language","conversation","express"]],
    ["Đời sống",["daily","home","family","food","travel","life","person"]],
  ];
  return groups.find(([,keys])=>keys.some(key=>text.includes(key)))?.[0] ?? "Từ vựng chung";
}

// Trái nghĩa thường chỉ có ở dạng gốc, nên thử thêm các dạng rút gọn khi tra rỗng.
async function antonymsFor(word:string) {
  const direct=await relatedWords(word,"rel_ant");
  if(direct.length) return direct;
  for(const form of lemmaOf(word)){
    const viaLemma=await relatedWords(form,"rel_ant");
    if(viaLemma.length) return viaLemma;
  }
  return [];
}

async function relatedWords(word:string,relation:"rel_syn"|"rel_ant"|"rel_trg"|"ml") {
  try{
    const response=await fetch(`https://api.datamuse.com/words?${relation}=${encodeURIComponent(word)}&max=8`);
    if(!response.ok) return [];
    const data=await response.json() as {word?:string}[];
    return data.map(item=>item.word?.trim()??"").filter(Boolean);
  }catch{return [];}
}

// Từ cùng chủ đề phải xin kèm thẻ md=fp để còn lọc theo tần suất, và lấy dư ứng
// viên vì qua bộ lọc sẽ rụng quá nửa. Xem lib/topical-words.mjs.
async function triggerCandidates(word:string) {
  try{
    const response=await fetch(`https://api.datamuse.com/words?rel_trg=${encodeURIComponent(word)}&md=fp&max=20`);
    if(!response.ok) return [];
    return await response.json() as DatamuseEntry[];
  }catch{return [];}
}

// "v", "verb", "n", "adj"… quy về đúng nhãn mà từ điển dùng.
function normalisePart(part?:string) {
  const value=(part??"").trim().toLowerCase();
  if(!value) return undefined;
  if(value.startsWith("v")) return "verb";
  if(value.startsWith("adv")) return "adverb";
  if(value.startsWith("adj")) return "adjective";
  if(value.startsWith("n")) return "noun";
  if(value.startsWith("prep")) return "preposition";
  return undefined;
}

function uniqueWords(items:string[],source:string) {
  return [...new Set(items.map(item=>item.trim().toLowerCase()).filter(item=>item&&item!==source))].slice(0,6);
}

// Dạng gốc thô sơ của từ. Datamuse chỉ có dữ liệu trái nghĩa cho dạng gốc:
// "weeds" không ra gì nhưng "weed" thì có.
function lemmaOf(word:string) {
  const forms=new Set<string>();
  if(/ies$/.test(word)) forms.add(word.replace(/ies$/,"y"));
  if(/(ses|xes|zes|ches|shes)$/.test(word)) forms.add(word.replace(/es$/,""));
  if(/s$/.test(word)&&!/ss$/.test(word)) forms.add(word.replace(/s$/,""));
  if(/ing$/.test(word)) { forms.add(word.replace(/ing$/,"")); forms.add(word.replace(/ing$/,"e")); }
  if(/ed$/.test(word)) { forms.add(word.replace(/ed$/,"")); forms.add(word.replace(/ed$/,"e")); }
  forms.delete(word);
  return [...forms].filter(item=>item.length>=3);
}

// Chủ đề IELTS. Ngoài từ và định nghĩa còn dựa vào danh sách từ liên tưởng của Datamuse,
// nhờ đó "rescue" ra "Emergency & Safety" thay vì rơi về nhãn chung chung.
const ieltsAreas=ieltsAreaData as [string,string[]][];
// Khớp theo ranh giới từ, không khớp chuỗi con: nếu không thì "vacated" dính "cat"
// và "appointment" dính "app". Từ khoá dài (>=5) được phép khớp phần đầu để phủ biến thể.
const keywordPatterns=new Map<string,RegExp>();
function matchesKeyword(text:string,key:string) {
  let pattern=keywordPatterns.get(key);
  if(!pattern){
    const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    pattern=key.length>=5?new RegExp(`\\b${escaped}`,"i"):new RegExp(`\\b${escaped}(s|es)?\\b`,"i");
    keywordPatterns.set(key,pattern);
  }
  return pattern.test(text);
}
function ieltsApplications(word:string,definition:string,meaningVi:string,triggers:string[]) {
  // Từ và định nghĩa được tính trọng số cao hơn từ liên tưởng.
  const strong=`${word} ${definition} ${meaningVi}`;
  const weak=triggers.join(" ");
  const scored=ieltsAreas
    .map(([name,keys])=>({name,score:keys.reduce((total,key)=>total+(matchesKeyword(strong,key)?2:0)+(matchesKeyword(weak,key)?1:0),0)}))
    .filter(item=>item.score>0)
    .sort((a,b)=>b.score-a.score);
  return scored.length?scored.slice(0,3).map(item=>item.name):["Chưa xác định được chủ đề — hãy tự chọn"];
}

async function lookupDatamuseEntry(word:string):Promise<DictionaryEntry[]> {
  try{
    const response=await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=dpr&max=3`);
    if(!response.ok) return [];
    const matches=await response.json() as DatamuseEntry[];
    const exact=matches.find(item=>item.word?.trim().toLowerCase()===word.toLowerCase());
    if(!exact?.defs?.length) return [];
    const groups=new Map<string,{definition?:string}[]>();
    for(const raw of exact.defs){
      const separator=raw.indexOf("\t");
      const shortPart=separator>=0?raw.slice(0,separator):"";
      const definition=(separator>=0?raw.slice(separator+1):raw).trim();
      const part=shortPart==="n"?"noun":shortPart==="v"?"verb":shortPart==="adj"?"adjective":shortPart==="adv"?"adverb":"";
      if(!definition) continue;
      groups.set(part,[...(groups.get(part)??[]),{definition}]);
    }
    const pronunciation=exact.tags?.find(tag=>tag.startsWith("pron:"))?.slice(5).trim();
    return [{word:exact.word,phonetic:pronunciation?`/${pronunciation}/`:undefined,meanings:[...groups].map(([partOfSpeech,definitions])=>({partOfSpeech,definitions}))}];
  }catch{return [];}
}

async function lookupEntries(word:string):Promise<DictionaryEntry[]> {
  try{
    const response=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,{headers:{Accept:"application/json"}});
    if(!response.ok) return lookupDatamuseEntry(word);
    const entries=await response.json() as DictionaryEntry[];
    return Array.isArray(entries)&&entries.length?entries:lookupDatamuseEntry(word);
  }catch{ return lookupDatamuseEntry(word); }
}

async function lookupEntry(word:string):Promise<DictionaryEntry|undefined> {
  return (await lookupEntries(word)).find(item=>item.word?.trim().toLowerCase()===word);
}

// Bản dịch bị coi là hỏng khi rỗng hoặc trả về nguyên văn tiếng Anh.
// Chuẩn hoá NFC ngay tại cửa ra của mọi bản dịch: Google Dịch có lúc trả về dạng
// tổ hợp (o + dấu mũ + dấu huyền rời), trình duyệt dựng thành "sô ̀i" với dấu trôi
// ra ngoài chữ. Đây là điểm chung của cả Google lẫn MyMemory nên chỉ cần sửa ở đây.
function usableTranslation(text:string, source:string) {
  const value=text.normalize("NFC").trim();
  return value&&value.toLowerCase()!==source.trim().toLowerCase()?value:"";
}

// Nguồn dịch chính: chất lượng tốt hơn hẳn với từ đơn (MyMemory khớp nhầm "blink" thành "block").
// Đây là endpoint không chính thức, không cần khoá, nên luôn có nguồn dự phòng phía dưới.
async function translateViaGoogle(text:string,from="en",to="vi") {
  try{
    const response=await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`);
    if(!response.ok) return "";
    const data=await response.json() as unknown;
    if(!Array.isArray(data)||!Array.isArray(data[0])) return "";
    const joined=(data[0] as unknown[]).map(part=>(Array.isArray(part)?String(part[0]??""):"")).join("");
    // Kiểm tra "dịch có ra gì không" chỉ áp dụng cho chiều Anh→Việt.
    return from==="en"?usableTranslation(joined,text):joined.normalize("NFC").trim();
  }catch{ return ""; }
}

async function translateViaMyMemory(text:string) {
  try{
    const response=await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`);
    const translated=await response.json() as {responseData?:{translatedText?:string}};
    return usableTranslation(translated.responseData?.translatedText??"",text);
  }catch{ return ""; }
}

// Bỏ phần ghi nguồn ở cuối câu trích dẫn, ví dụ "… ― Gary Cook".
function cleanExample(raw:string) {
  return raw.replace(/\s*[―—–]{1,2}\s*[^.!?]*$/,"").replace(/\s+/g," ").trim();
}

type CorpusSentence={text:string;vi?:string};
type Sense={index:number;part:string;definition:string;example?:string;synonyms:string[];antonyms:string[];definitionVi?:string};

// Một từ có thể mang nhiều nghĩa rất xa nhau: "fixed" vừa là "đã sửa", vừa là
// "cố định", vừa là "đã triệt sản". Người học biết mình cần nghĩa nào, nên ta liệt
// kê các nghĩa của từ điển để họ chọn, thay vì đoán rồi áp đặt.
function listSenses(entries:DictionaryEntry[]):Sense[] {
  const senses:Sense[]=[];
  for(const entry of entries)
    for(const meaning of entry.meanings??[])
      for(const definition of meaning.definitions??[]){
        const text=(definition.definition??"").replace(/\s+/g," ").trim();
        if(!text) continue;
        senses.push({
          index:senses.length,
          part:meaning.partOfSpeech??"",
          definition:text,
          example:definition.example?cleanExample(definition.example):undefined,
          synonyms:[...(meaning.synonyms??[]),...(definition.synonyms??[])],
          antonyms:[...(meaning.antonyms??[]),...(definition.antonyms??[])],
        });
        if(senses.length>=12) return senses;
      }
  return senses;
}

// Dịch cả chùm định nghĩa trong MỘT lần gọi bằng cách nối chúng bằng xuống dòng.
// Nếu số dòng trả về không khớp thì bỏ qua, thà không có bản dịch còn hơn ghép lệch.
async function translateEach(lines:string[]) {
  if(!lines.length) return [];
  const joined=lines.map(line=>line.replace(/\n/g," ")).join("\n");
  const translated=await translateViaGoogle(joined);
  if(!translated) return [];
  const parts=translated.split("\n").map(part=>part.trim());
  return parts.length===lines.length?parts:[];
}

// Chỉ chấm điểm theo chiều ngược: dịch từng định nghĩa sang tiếng Việt rồi so với
// nghĩa người dùng nhập. Có thử thêm chiều xuôi (dịch nghĩa người dùng sang tiếng
// Anh rồi mở rộng bằng Datamuse) nhưng đo thực tế thì nó đẩy sai thêm ca "spring"
// mà không cứu được ca nào, nên bỏ. Máy đoán chỉ để xếp thứ tự — quyền chốt nghĩa
// là của người dùng qua bộ chọn bên dưới ô nghĩa.

const vietnameseStopWords=new Set(["một","các","những","của","và","là","có","được","cho","trong","với","hoặc","người","vật","làm","gì","đó","đặc","biệt","khi","để"]);
function normaliseVi(text:string) {
  return text.toLowerCase().normalize("NFC").replace(/[^\p{L}\s]/gu," ").replace(/\s+/g," ").trim();
}
// Chấm điểm bằng cách so bản dịch tiếng Việt của từng nghĩa với nghĩa người dùng nhập.
// Trùng nguyên cụm ("bờ sông" nằm trong "ven sông, hồ") ăn điểm cao hơn trùng lẻ từng chữ.
function scoreSenseAgainstMeaning(definitionVi:string|undefined,meaningVi:string) {
  if(!definitionVi) return 0;
  const target=normaliseVi(meaningVi);
  if(!target) return 0;
  const haystack=normaliseVi(definitionVi);
  const whole=haystack.includes(target)?3:0;
  const words=new Set(haystack.split(" "));
  const overlap=target.split(" ").filter(item=>item.length>1&&!vietnameseStopWords.has(item)&&words.has(item)).length;
  return whole+overlap;
}

// Từ điển chỉ kèm câu ví dụ cho một phần nhỏ mục từ: "drafted" có câu thật, còn
// "hockey", "maple" thì không và rơi vào khung câu "We talked about the importance
// of X in daily life" — từ nào cũng giống nhau. Tatoeba là kho câu do người học và
// người bản ngữ đóng góp, nhiều câu đã có sẵn bản dịch tiếng Việt do người dịch.
async function tatoebaSentence(word:string,meaningVi?:string):Promise<CorpusSentence|undefined> {
  // Vòng 1 xin luôn câu đã có bản dịch tiếng Việt (khỏi phải dịch máy, và không sai
  // nghĩa như khi máy dịch "drafted" thành "soạn thảo"); vòng 2 nới ra lấy câu tiếng Anh.
  for(const withVietnamese of [true,false]){
    try{
      const url=`https://tatoeba.org/en/api_v0/search?query=${encodeURIComponent(word)}&from=eng${withVietnamese?"&to=vie":""}&sort=relevance&limit=12`;
      const response=await fetch(url,{headers:{"User-Agent":"Lexilo/1.0"}});
      if(!response.ok) continue;
      const data=await response.json() as {results?:{text?:string;translations?:{lang?:string;text?:string}[][]}[]};
      const picked=(data.results??[])
        .map(item=>{
          const text=cleanExample(item.text??"");
          const vi=(item.translations??[]).flat().find(entry=>entry.lang==="vie")?.text?.normalize("NFC").trim();
          return {text,vi:vi||undefined};
        })
        .filter(item=>isUsableSentence(item.text,word)&&(!withVietnamese||item.vi))
        // Câu 8–14 chữ vừa đủ ngữ cảnh mà không quá dài; "That's a maple." thì học được ít.
        // Có nghĩa người dùng thì ưu tiên câu mà bản dịch tiếng Việt nhắc đúng nghĩa đó:
        // "fixed = đã sửa" sẽ chuộng câu dịch ra có chữ "sửa" hơn câu nói về bữa tối.
        .sort((a,b)=>{
          const byMeaning=meaningVi?scoreSenseAgainstMeaning(b.vi,meaningVi)-scoreSenseAgainstMeaning(a.vi,meaningVi):0;
          return byMeaning||sentenceScore(b.text)-sentenceScore(a.text);
        });
      if(picked[0]) return picked[0];
    }catch{ /* hết cách thì để tầng dưới lo */ }
  }
  return undefined;
}
// Đúng một câu trọn vẹn, đủ dài để có ngữ cảnh mà không thành cả đoạn.
function isSentenceShape(text:string) {
  if(!text) return false;
  const count=text.split(/\s+/).length;
  if(count<4||count>24) return false;
  if(!/^["'“]?[A-Z]/.test(text)||!/[.!?]["'”]?$/.test(text)) return false;
  return !/[.!?]["'”]?\s+["'“]?[A-Z]/.test(text);
}
// Câu lấy từ kho ngữ liệu còn phải chứa chính từ đang học, vì không có gì bảo đảm
// nó nói về từ đó. Câu đi kèm một nghĩa trong từ điển thì không cần kiểm tra này:
// nó vốn thuộc về nghĩa đó, và thường dùng dạng gốc ("fixed" → "…had the vet fix him").
function isUsableSentence(text:string,word:string) {
  if(!isSentenceShape(text)) return false;
  const stem=word.replace(/(ies|es|s)$/,"");
  const pattern=new RegExp(`\\b${(stem.length>=3?stem:word).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}`,"i");
  return pattern.test(text);
}
function sentenceScore(text:string) {
  const count=text.split(/\s+/).length;
  return count>=8&&count<=14?3:count>=6&&count<=18?2:1;
}

// Từ điển hay giấu câu ví dụ ở các nghĩa phía sau, không phải nghĩa đầu tiên.
// Chỉ nhận câu hoàn chỉnh có chứa chính từ đang học, để không lấy phải mẩu cụm rời rạc.
type Meaning=NonNullable<DictionaryEntry["meanings"]>[number];
function pickDictionaryExample(entries:DictionaryEntry[], word:string, chosenMeaning?:Meaning, preferredPart?:string) {
  const stem=word.replace(/(ies|es|s)$/,"");
  const scored=entries
    .flatMap(entry=>(entry.meanings??[]).flatMap(meaning=>(meaning.definitions??[]).map(definition=>({text:definition.example?cleanExample(definition.example):"",part:meaning.partOfSpeech??"",sameMeaning:meaning===chosenMeaning}))))
    .filter(item=>item.text)
    .map(item=>{
      const lower=item.text.toLowerCase();
      const exact=lower.includes(word);
      const viaStem=stem.length>=3&&lower.includes(stem);
      const count=item.text.split(/\s+/).length;
      const wholeSentence=/^["'“]?[A-Z]/.test(item.text)&&/[.!?]["'”]?$/.test(item.text);
      if(!wholeSentence) return null;
      // Một số mục từ điển nhét cả đoạn hai ba câu ("The ambassador has been closeted…
      // We're all worried…"). Người học chỉ cần đúng một câu chứa từ.
      if(/[.!?]["'”]?\s+["'“]?[A-Z]/.test(item.text)) return null;
      if(!exact&&!(viaStem&&count>=6)) return null;
      if(count<5||count>28) return null;
      // Cùng nghĩa với định nghĩa đang hiển thị được ưu tiên cao nhất, để định nghĩa và ví dụ không lệch nghĩa nhau.
      const score=(item.sameMeaning?4:0)+(exact?3:2)+(preferredPart&&item.part===preferredPart?2:0)+(count<=18?1:0);
      return {text:item.text,score};
    })
    .filter((item):item is {text:string;score:number}=>item!==null)
    .sort((a,b)=>b.score-a.score);
  return scored[0]?.text;
}

// Không có câu ví dụ thật thì dùng khung câu ghi chú học tập, chọn theo từ để mỗi từ một khung khác nhau.
const studyFrames:[string,string][]=[
  ['The word "W" came up twice in today\'s reading.','Từ “W” xuất hiện hai lần trong bài đọc hôm nay.'],
  ['I wrote "W" in my notebook so I would not forget it.','Tôi đã ghi “W” vào sổ tay để khỏi quên.'],
  ['Our teacher asked us to use "W" in a sentence.','Cô giáo yêu cầu chúng tôi đặt câu với “W”.'],
  ['I heard "W" in a podcast on the way to work.','Tôi nghe thấy “W” trong một podcast trên đường đi làm.'],
  ['"W" is the word I want to remember this week.','“W” là từ tôi muốn nhớ trong tuần này.'],
  ['I looked up "W" after meeting it in an article.','Tôi tra “W” sau khi gặp nó trong một bài báo.'],
  ['My friend used "W" and I had to ask what it meant.','Bạn tôi dùng từ “W” và tôi đã phải hỏi nó nghĩa là gì.'],
  ['I met "W" for the first time in a novel last night.','Tối qua tôi gặp “W” lần đầu trong một cuốn tiểu thuyết.'],
  ['The teacher wrote "W" on the board and explained it slowly.','Cô giáo viết “W” lên bảng và giải thích chậm rãi.'],
  ['I keep forgetting "W", so I put it on a sticky note.','Tôi cứ quên “W” nên đã dán nó lên một tờ giấy nhớ.'],
  ['"W" appeared three times in the same chapter.','“W” xuất hiện ba lần trong cùng một chương.'],
  ['I practised saying "W" out loud until it felt natural.','Tôi tập đọc to “W” cho đến khi thấy tự nhiên.'],
  ['A colleague explained what "W" means during our meeting.','Một đồng nghiệp đã giải thích “W” nghĩa là gì trong cuộc họp.'],
];
function studyFrameFor(word:string) {
  let hash=0;
  for(const character of word) hash=(hash*31+character.charCodeAt(0))>>>0;
  const [en,vi]=studyFrames[hash%studyFrames.length];
  return {example:en.replaceAll("W",word),exampleVi:vi.replaceAll("W",word)};
}

type UsageDetail={term:string;meaningVi:string;example:string;exampleVi:string};
const usageOverrides:Record<string,{meaningVi:string;example:string;exampleVi:string}>={
  cabinet:{meaningVi:"tủ có ngăn hoặc kệ để cất đồ",example:"The cleaning supplies are stored in a cabinet under the sink.",exampleVi:"Các vật dụng vệ sinh được cất trong chiếc tủ dưới bồn rửa."},
};
async function usageDetails(items:string[],translate:(text:string)=>Promise<string>):Promise<UsageDetail[]> {
  return Promise.all(items.slice(0,4).map(async(term)=>{
    const override=usageOverrides[term];
    if(override) return {term,...override};
    const entries=await lookupEntries(term);
    const part=entries[0]?.meanings?.[0]?.partOfSpeech??"";
    const real=pickDictionaryExample(entries,term);
    const capital=term.charAt(0).toUpperCase()+term.slice(1);
    const fallback=part.includes("verb")?`They decided to ${term} after discussing the problem.`:part.includes("adjective")?`The result was ${term} for everyone involved.`:`${capital} played an important role in the situation.`;
    const example=real||fallback;
    const [meaningVi,exampleVi]=await Promise.all([translate(term),translate(example)]);
    return {term,meaningVi:meaningVi||"Chưa có bản dịch",example,exampleVi:exampleVi||"Chưa có bản dịch câu."};
  }));
}

function phoneticOf(entry?:DictionaryEntry) {
  const raw=entry?.phonetic||entry?.phonetics?.find(item=>item.text)?.text||"";
  return raw.replace(/^\/|\/$/g,"").trim();
}

// Từ nối/mạo từ không mang nghĩa riêng nên bỏ khỏi phần giải nghĩa từng từ.
const functionWords=new Set(["a","an","the","of","to","in","on","at","for","and","or","but","is","are","am","be","been","with","as","that","this","it","its","by","from","not","no","so","up","out","off","over","into","than","then","there","here","he","she","they","we","you","i","my","your","his","her"]);

export async function POST(request:Request) {
  // meaning_vi: nghĩa người dùng tự nhập, dùng để xếp hạng các nghĩa của từ điển.
  // sense: người dùng đã chọn hẳn một nghĩa trong danh sách trả về lần trước.
  const { term, part_of_speech:partHint, meaning_vi:meaningHint, sense:senseHint }=await request.json() as {term?:string;part_of_speech?:string;meaning_vi?:string;sense?:number};
  const word=term?.trim().toLowerCase().replace(/\s+/g," ");
  if(!word||!/^[a-z][a-z'\- /]{0,79}$/i.test(word)) return NextResponse.json({error:"Chỉ hỗ trợ chữ cái, dấu nháy, gạch nối và dấu /."},{status:400});
  // Dấu / trong ghi chú thường chỉ hai cách nói tương đương. Dùng cụm đầu tiên để tra
  // từ điển nhưng dịch và giữ nguyên toàn bộ biểu thức cho thẻ học.
  const lookupWord=word.split("/")[0].trim();
  const isPhrase=word.includes(" ");
  const translate=async(text:string)=>(await translateViaGoogle(text))||(await translateViaMyMemory(text));
  try{
    // Từ điển chỉ có mục từ cho từ đơn và một vài cụm cố định.
    const entries=await lookupEntries(lookupWord);
    const entry=entries.find(item=>item.word?.trim().toLowerCase()===lookupWord);
    if(!entry&&!isPhrase) return NextResponse.json({error:"Không tìm thấy từ trong từ điển."},{status:404});
    // Loại từ do người dùng/hồ sơ từ vựng cung cấp được ưu tiên: "flew" là động từ,
    // nếu lấy nghĩa đầu tiên sẽ ra danh từ "môi chó".
    const hinted=normalisePart(partHint);
    const preferredPart=hinted??(/able$|ible$|ful$|less$|ous$|ive$|al$|ic$|y$/.test(word)?"adjective":undefined);
    // Từ điển tách mỗi loại từ thành một mục riêng ("flew" có 3 mục: noun, verb, adjective),
    // nên phải tìm trên tất cả các mục chứ không chỉ mục đầu.
    const allMeanings=entries.flatMap(item=>item.meanings??[]);
    const meaning=(preferredPart&&allMeanings.find(item=>item.partOfSpeech===preferredPart))||entry?.meanings?.[0]||allMeanings[0];
    // Người dùng đã nhập nghĩa thì giữ nguyên nghĩa của họ, đừng đè bằng bản dịch máy.
    const meaningVi=meaningHint?.trim()||verifiedVietnamese[word]||await translate(word);

    // Liệt kê và xếp hạng các nghĩa. Chỉ dịch định nghĩa khi có nghĩa người dùng để
    // so, tránh thêm một lượt mạng cho luồng tra bình thường.
    const senses=listSenses(entries);
    if(meaningHint?.trim()&&senses.length>1){
      const translations=await translateEach(senses.map(item=>item.definition));
      senses.forEach((item,position)=>{ item.definitionVi=translations[position]; });
      const total=(item:Sense)=>scoreSenseAgainstMeaning(item.definitionVi,meaningHint);
      senses.sort((a,b)=>{
        const gap=total(b)-total(a);
        if(gap) return gap;
        // Điểm bằng nhau thì ưu tiên nghĩa đúng loại từ, rồi giữ thứ tự của từ điển.
        const partGap=Number(b.part===preferredPart)-Number(a.part===preferredPart);
        return partGap||a.index-b.index;
      });
    }
    // senseHint là chỉ số gốc trong từ điển, không phải vị trí sau khi sắp xếp.
    const chosen=senseHint===undefined?undefined:senses.find(item=>item.index===senseHint);
    const ranked=chosen??(meaningHint?.trim()?senses[0]:undefined);
    const definition=ranked?{definition:ranked.definition,example:ranked.example,synonyms:ranked.synonyms,antonyms:ranked.antonyms}:meaning?.definitions?.[0];
    if(!entry){
      // Cụm từ không có mục từ riêng: dựng IPA và phần giải nghĩa từ dữ liệu thật của từng từ thành phần.
      const parts=word.split(" ");
      const partEntries=await Promise.all(parts.map(lookupEntry));
      const phonetics=partEntries.map(phoneticOf);
      const ipa=phonetics.every(Boolean)?`/${phonetics.join(" ")}/`:"";
      const glossary=parts
        .map((part,index)=>{
          if(functionWords.has(part)) return "";
          const wordDefinition=partEntries[index]?.meanings?.[0]?.definitions?.[0]?.definition;
          return wordDefinition?`${part}: ${wordDefinition}`:"";
        })
        .filter(Boolean)
        .join("\n");
      // Cụm từ cũng ưu tiên câu thật; hết cách mới dùng khung câu dựng sẵn.
      // Dịch máy sẽ dịch luôn cụm từ trong ngoặc kép, làm mất chính thứ cần học — nên khung câu có sẵn bản tiếng Việt.
      const corpus=await tatoebaSentence(word);
      const frame=studyFrameFor(word);
      const example=corpus?.text??frame.example;
      const exampleVi=corpus?(corpus.vi??await translate(corpus.text)):frame.exampleVi;
      if(!meaningVi&&!glossary) return NextResponse.json({error:"Không tra được cụm từ này. Vui lòng nhập nội dung thủ công."},{status:404});
      return NextResponse.json({term:word,ipa,part_of_speech:"phrase",meaning_vi:meaningVi,definition_en:glossary,example,example_vi:exampleVi,collocation:word,collocation_vi:meaningVi,topic:topicFor(word,glossary,meaningVi),partial:true,example_source:corpus?"corpus":"template"});
    }
    const definitionEn=definition?.definition||`The meaning of ${word}.`;
    const [datamuseSynonyms,datamuseAntonyms,triggerRaw]=await Promise.all([relatedWords(word,"rel_syn"),antonymsFor(word),triggerCandidates(word)]);
    const triggers=triggerRaw.map(item=>item.word?.trim()??"").filter(Boolean);
    const blockedSuggestions:Record<string,string[]>={closet:["armchair"],closets:["armchair"]};
    const blocked=new Set(blockedSuggestions[word]??[]);
    const synonyms=uniqueWords([...(meaning?.synonyms??[]),...(definition?.synonyms??[]),...datamuseSynonyms],word).filter(item=>!blocked.has(item));
    const antonyms=uniqueWords([...(meaning?.antonyms??[]),...(definition?.antonyms??[]),...datamuseAntonyms],word);
    // Từ hay đi cùng chủ đề — lấp chỗ trống cho những từ vốn không có trái nghĩa như "rescue".
    // Lấy dư 12 rồi mới trừ đồng/trái nghĩa để không bị hụt sau khi lọc.
    const related=topicalWords(triggerRaw,word,12).filter((item:string)=>!synonyms.includes(item)&&!antonyms.includes(item)).slice(0,6);
    const [synonymDetails,antonymDetails,relatedDetails]=await Promise.all([
      usageDetails(synonyms,translate),usageDetails(antonyms,translate),usageDetails(related,translate),
    ]);
    // Ưu tiên câu ví dụ thật trong từ điển; hết cách mới dùng khung câu ghi chú.
    const practical=practicalPhrases[word];
    const generated=generatedPhraseFor(word,meaning?.partOfSpeech||"");
    const senseExample=ranked?.example&&isSentenceShape(ranked.example)?ranked.example:undefined;
    // Đã chốt một nghĩa thì tuyệt đối không mượn ví dụ của nghĩa khác: chọn "to mend,
    // to repair" mà đưa câu "She fixed dinner for the kids." là sai hẳn ngữ cảnh.
    // Không có câu của chính nghĩa đó thì để Tatoeba lo, và Tatoeba cũng được chấm
    // điểm theo nghĩa người dùng nhập.
    const realExample=ranked?senseExample:senseExample??pickDictionaryExample(entries,word,meaning,preferredPart??meaning?.partOfSpeech);
    const phrase=practical?.phrase??generated.phrase;
    const phraseVi=practical?.meaning??await translate(phrase);
    // Thứ tự ưu tiên: câu viết tay > câu thật trong từ điển > câu thật của Tatoeba >
    // khung câu tự dựng. Chỉ gọi Tatoeba khi hai nguồn trên đều không có, để khỏi
    // thêm một lượt mạng cho những từ vốn đã có câu tốt.
    const corpus=practical?.example||realExample?undefined:await tatoebaSentence(word,meaningHint?.trim());
    const example=practical?.example??realExample??corpus?.text??generated.example;
    // Bản dịch của người viết trên Tatoeba đúng nghĩa hơn dịch máy: máy dịch câu
    // "He was drafted during the Vietnam War." thành "được soạn thảo".
    const exampleVi=practical?.exampleVi??(corpus&&example===corpus.text&&corpus.vi?corpus.vi:await translate(example));
    const topic=topicFor(word,definitionEn,meaningVi);
    const paraphrases=uniqueWords([phrase,...synonyms.map(item=>`${item} (${meaningVi||definitionEn})`)],word).slice(0,5);
    return NextResponse.json({term:word,ipa:entry.phonetic||entry.phonetics?.find(p=>p.text)?.text||"/…/",part_of_speech:ranked?.part||meaning?.partOfSpeech||"",meaning_vi:meaningVi||definitionEn,definition_en:definitionEn,example,example_vi:exampleVi,collocation:phrase,collocation_vi:phraseVi||meaningVi,synonyms,antonyms,related,synonym_details:synonymDetails,antonym_details:antonymDetails,related_details:relatedDetails,paraphrases,ielts_topics:ieltsApplications(word,definitionEn,meaningVi,triggers),topic,partial:false,example_source:practical?"practical":senseExample?"sense":realExample?"dictionary":corpus?"corpus":"generated_phrase",
      sense:ranked?.index,
      senses:senses.map(item=>({index:item.index,part_of_speech:item.part,definition_en:item.definition,definition_vi:item.definitionVi,example:item.example}))});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Không thể tự động điền từ."},{status:404});}
}
