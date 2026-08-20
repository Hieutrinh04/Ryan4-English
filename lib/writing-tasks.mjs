// Đề luyện viết.
//
// Đề ở đây do dự án tự soạn và số liệu là số giả định. KHÔNG chép đề của Cambridge
// hay bất kỳ bộ đề thi thật nào — chúng có bản quyền. Biểu đồ cũng tự vẽ từ số
// liệu bên dưới chứ không lấy ảnh ở đâu về.
//
// Muốn thêm đề: thêm một phần tử vào TASKS. Đề Task 1 cần `chart`; đề Task 2 chỉ
// cần `prompt`.

export const TASK1_MIN_WORDS = 150;
export const TASK2_MIN_WORDS = 250;

/** Thời gian khuyến nghị, tính bằng phút, theo cách chia của đề thi thật. */
export const TASK_MINUTES = { 1: 20, 2: 40 };

export const TASKS = [
  {
    id: "t1-coffee",
    exam: "ielts",
    part: 1,
    kind: "Biểu đồ đường",
    title: "Lượng cà phê và trà tiêu thụ ở bốn thành phố",
    prompt:
      "The line graph shows the average amount of coffee and tea consumed per person in four cities between 2010 and 2022. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
    chart: {
      type: "line",
      unit: "kg mỗi người",
      xLabels: ["2010", "2013", "2016", "2019", "2022"],
      series: [
        { name: "Coffee — Hanoi", values: [1.2, 1.8, 2.6, 3.4, 4.1] },
        { name: "Tea — Hanoi", values: [3.8, 3.5, 3.1, 2.8, 2.4] },
        { name: "Coffee — Seoul", values: [2.4, 3.1, 3.9, 4.4, 4.8] },
        { name: "Tea — Seoul", values: [2.9, 2.7, 2.5, 2.3, 2.1] },
      ],
    },
  },
  {
    id: "t1-transport",
    exam: "ielts",
    part: 1,
    kind: "Biểu đồ cột",
    title: "Cách đi lại tới nơi làm việc theo nhóm tuổi",
    prompt:
      "The bar chart shows how people in three age groups travelled to work in one city in 2023. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
    chart: {
      type: "bar",
      unit: "% số người",
      xLabels: ["18–29", "30–49", "50+"],
      series: [
        { name: "Xe máy", values: [58, 47, 34] },
        { name: "Xe buýt", values: [22, 18, 27] },
        { name: "Ô tô riêng", values: [8, 26, 31] },
        { name: "Đi bộ / xe đạp", values: [12, 9, 8] },
      ],
    },
  },
  {
    id: "t1-water",
    exam: "ielts",
    part: 1,
    kind: "Biểu đồ cột",
    title: "Lượng nước dùng cho ba mục đích ở hai quốc gia",
    prompt:
      "The chart shows how water was used for agriculture, industry and households in two countries in 2022. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
    chart: {
      type: "bar",
      unit: "% tổng lượng nước",
      xLabels: ["Nông nghiệp", "Công nghiệp", "Sinh hoạt"],
      series: [
        { name: "Quốc gia A", values: [71, 18, 11] },
        { name: "Quốc gia B", values: [34, 48, 18] },
      ],
    },
  },
  {
    id: "t2-remote",
    exam: "ielts",
    part: 2,
    kind: "Nêu ý kiến",
    title: "Làm việc từ xa",
    prompt:
      "Some people believe that working from home benefits both employees and companies, while others think it makes teamwork harder. Discuss both views and give your own opinion.",
  },
  {
    id: "t2-exams",
    exam: "ielts",
    part: 2,
    kind: "Đồng ý hay không",
    title: "Chấm điểm bằng kỳ thi",
    prompt:
      "Schools should judge students mainly by examinations rather than by coursework completed during the year. To what extent do you agree or disagree?",
  },
  {
    id: "t2-city",
    exam: "ielts",
    part: 2,
    kind: "Vấn đề và giải pháp",
    title: "Thành phố quá đông",
    prompt:
      "Many large cities are becoming overcrowded, which puts pressure on housing and transport. What problems does this cause, and what measures could reduce them?",
  },
  {
    id: "toeic-email",
    exam: "toeic",
    part: 1,
    kind: "Email công việc",
    title: "Trả lời khách hàng phàn nàn giao hàng trễ",
    prompt:
      "You work in customer service. A customer has written to say their order arrived four days late and one item was missing. Write a reply: apologise, explain what happened, and say what you will do to fix it.",
  },
  {
    id: "vstep-letter",
    exam: "vstep",
    part: 1,
    kind: "Thư",
    title: "Thư xin nghỉ phép",
    prompt:
      "Write a letter to your manager asking for three days of leave next month. Explain why you need the leave, say how your work will be covered, and suggest when you could make up the time.",
  },
];

/** Số từ tối thiểu của một đề. */
export function minWordsOf(task) {
  return task?.part === 2 ? TASK2_MIN_WORDS : TASK1_MIN_WORDS;
}

/** Lọc đề theo kỳ thi và theo phần. `part` bằng 0 nghĩa là lấy tất cả. */
export function filterTasks(tasks, { exam = "ielts", part = 0 } = {}) {
  return (tasks ?? []).filter((task) => task.exam === exam && (part === 0 || task.part === part));
}

/** Nhóm đề theo phần, để màn hình chia thành từng khối như đề thi. */
export function groupByPart(tasks) {
  const groups = new Map();
  for (const task of tasks ?? []) {
    const list = groups.get(task.part) ?? [];
    list.push(task);
    groups.set(task.part, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([part, list]) => ({ part, tasks: list }));
}
