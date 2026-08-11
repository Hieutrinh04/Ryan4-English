export type DictationLevel = "A1"|"A2"|"B1"|"B2"|"C1";
export type DictationLesson = {
  id:string;
  topic:string;
  level:DictationLevel;
  sentence:string;
  title:string;
  sourceName?:string;
  sourceUrl?:string;
  license?:string;
};

export const dictationLessons:DictationLesson[]=[
  {id:"voa-welcome-1",topic:"VOA Learning English",level:"A1",title:"Welcome!",sentence:"Hi! Are you Anna?",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-welcome-2",topic:"VOA Learning English",level:"A1",title:"Welcome!",sentence:"Yes! Hi there! Are you Pete?",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-welcome-3",topic:"VOA Learning English",level:"A1",title:"Welcome!",sentence:"Nice to meet you.",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-welcome-4",topic:"VOA Learning English",level:"A1",title:"Welcome!",sentence:"My new apartment!",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-lesson-one/3111026.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-budget-1",topic:"VOA Learning English",level:"B1",title:"Budget Cuts",sentence:"My boss has called a meeting.",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-budget-2",topic:"VOA Learning English",level:"B1",title:"Budget Cuts",sentence:"I wonder what it is about.",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-budget-3",topic:"VOA Learning English",level:"B1",title:"Budget Cuts",sentence:"We should not gossip because that is how rumors start.",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html",license:"Public domain · ghi nguồn VOA"},
  {id:"voa-budget-4",topic:"VOA Learning English",level:"B1",title:"Budget Cuts",sentence:"The reason for this meeting is to give out new assignments.",sourceName:"VOA Learning English",sourceUrl:"https://learningenglish.voanews.com/a/lets-learn-english-level-2-lesson1/3960391.html",license:"Public domain · ghi nguồn VOA"},
  {id:"daily-a1-1",topic:"Đời sống hằng ngày",level:"A1",title:"Buổi sáng",sentence:"I wake up at seven and drink a glass of water."},
  {id:"daily-a1-2",topic:"Đời sống hằng ngày",level:"A1",title:"Bữa tối",sentence:"My family usually eats dinner together in the kitchen."},
  {id:"daily-a2-1",topic:"Đời sống hằng ngày",level:"A2",title:"Cuối tuần",sentence:"On weekends, I clean my room and visit my grandparents."},
  {id:"daily-b1-1",topic:"Đời sống hằng ngày",level:"B1",title:"Thói quen tốt",sentence:"Building a simple morning routine helps me stay focused throughout the day."},
  {id:"travel-a1-1",topic:"Du lịch",level:"A1",title:"Nhà ga",sentence:"The train leaves the station at half past nine."},
  {id:"travel-a2-1",topic:"Du lịch",level:"A2",title:"Khách sạn",sentence:"We booked a small hotel near the center of the city."},
  {id:"travel-b1-1",topic:"Du lịch",level:"B1",title:"Chuyến đi bất ngờ",sentence:"Although our flight was delayed, we arrived before the last bus departed."},
  {id:"travel-b2-1",topic:"Du lịch",level:"B2",title:"Du lịch bền vững",sentence:"Responsible travelers often choose local services to reduce their environmental impact."},
  {id:"work-a1-1",topic:"Công việc",level:"A1",title:"Văn phòng",sentence:"She works in a busy office from Monday to Friday."},
  {id:"work-a2-1",topic:"Công việc",level:"A2",title:"Cuộc họp",sentence:"Our manager moved the weekly meeting to Thursday afternoon."},
  {id:"work-b1-1",topic:"Công việc",level:"B1",title:"Làm việc nhóm",sentence:"Clear communication allows the team to solve difficult problems more efficiently."},
  {id:"work-c1-1",topic:"Công việc",level:"C1",title:"Khả năng thích nghi",sentence:"Organizations that encourage experimentation tend to adapt more effectively to unpredictable market conditions."},
  {id:"tech-a1-1",topic:"Công nghệ",level:"A1",title:"Điện thoại",sentence:"My phone needs to charge before I leave the house."},
  {id:"tech-a2-1",topic:"Công nghệ",level:"A2",title:"Mật khẩu",sentence:"You should use a strong password for every important account."},
  {id:"tech-b1-1",topic:"Công nghệ",level:"B1",title:"Cập nhật phần mềm",sentence:"The development team will deploy the security update after completing all tests."},
  {id:"tech-b2-1",topic:"Công nghệ",level:"B2",title:"Trí tuệ nhân tạo",sentence:"Artificial intelligence can identify useful patterns in extremely large collections of data."},
  {id:"story-a1-1",topic:"Truyện ngắn",level:"A1",title:"Chú mèo nhỏ",sentence:"A small cat waited quietly beside the blue garden gate."},
  {id:"story-a2-1",topic:"Truyện ngắn",level:"A2",title:"Chiếc ví bị mất",sentence:"Daniel found a wallet and returned it to its grateful owner."},
  {id:"story-b1-1",topic:"Truyện ngắn",level:"B1",title:"Ánh đèn cuối phố",sentence:"When the lights suddenly went out, the neighbors gathered and shared their candles."},
  {id:"story-b2-1",topic:"Truyện ngắn",level:"B2",title:"Bức thư",sentence:"The forgotten letter revealed why her grandfather had never returned to the village."},
  {id:"science-a2-1",topic:"Khoa học & thiên nhiên",level:"A2",title:"Mưa",sentence:"Warm air rises and cools before the water falls as rain."},
  {id:"science-b1-1",topic:"Khoa học & thiên nhiên",level:"B1",title:"Đại dương",sentence:"Healthy oceans absorb carbon dioxide and support millions of different species."},
  {id:"science-b2-1",topic:"Khoa học & thiên nhiên",level:"B2",title:"Năng lượng sạch",sentence:"Researchers are developing more efficient batteries to store electricity from renewable sources."},
  {id:"science-c1-1",topic:"Khoa học & thiên nhiên",level:"C1",title:"Đa dạng sinh học",sentence:"The rapid decline in biodiversity may undermine ecosystems that communities depend on for survival."},
  {id:"conversation-a1-1",topic:"Hội thoại",level:"A1",title:"Quán cà phê",sentence:"Could I have a cup of coffee and some bread, please?"},
  {id:"conversation-a2-1",topic:"Hội thoại",level:"A2",title:"Hỏi đường",sentence:"Excuse me, could you tell me how to get to the museum?"},
  {id:"conversation-b1-1",topic:"Hội thoại",level:"B1",title:"Đổi lịch hẹn",sentence:"Would you mind moving our appointment to a little later tomorrow?"},
  {id:"conversation-b2-1",topic:"Hội thoại",level:"B2",title:"Nêu quan điểm",sentence:"I understand your concern, but we should consider the long-term benefits as well."},
  {id:"numbers-a1-1",topic:"Số & thời gian",level:"A1",title:"Số điện thoại",sentence:"My new phone number is zero nine eight, three five two, seven four one."},
  {id:"numbers-a2-1",topic:"Số & thời gian",level:"A2",title:"Lịch trình",sentence:"The appointment begins at quarter past two on September eighteenth."},
  {id:"numbers-b1-1",topic:"Số & thời gian",level:"B1",title:"Báo cáo",sentence:"Sales increased by twelve point five percent during the second quarter."},
];

export const dictationTopics=[...new Set(dictationLessons.map(item=>item.topic))];
export const dictationLevels:DictationLevel[]=["A1","A2","B1","B2","C1"];
