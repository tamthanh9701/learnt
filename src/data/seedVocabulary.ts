export interface SeedTopic {
  id: string;
  name_en: string;
  name_vi: string;
  description_en: string;
  description_vi: string;
}

export interface SeedFlashcard {
  id: string;
  topic_id: string;
  word: string;
  part_of_speech: string;
  phonetic: string;
  definition_en: string;
  definition_vi: string;
  example_en: string;
  example_vi: string;
}

export const seedTopics: SeedTopic[] = [
  {
    id: 'topic-business',
    name_en: 'Business English',
    name_vi: 'Tiếng Anh Thương Mại',
    description_en: 'Essential vocabulary for workplace, meetings, and business communication.',
    description_vi: 'Từ vựng thiết yếu cho công sở, cuộc họp và giao tiếp kinh doanh.',
  },
  {
    id: 'topic-technology',
    name_en: 'Technology & AI',
    name_vi: 'Công Nghệ & Trí Tuệ Nhân Tạo',
    description_en: 'Learn terms about computer science, software development, and AI trends.',
    description_vi: 'Học các thuật ngữ về khoa học máy tính, phát triển phần mềm và xu hướng AI.',
  },
  {
    id: 'topic-travel',
    name_en: 'Travel & Tourism',
    name_vi: 'Du Lịch & Khám Phá',
    description_en: 'Vocabulary for airports, hotels, directions, and ordering food.',
    description_vi: 'Từ vựng hữu ích tại sân bay, khách sạn, hỏi đường và gọi món ăn.',
  },
  {
    id: 'topic-daily-life',
    name_en: 'Daily Expressions',
    name_vi: 'Giao Tiếp Hàng Ngày',
    description_en: 'Common idioms, phrasal verbs, and expressions for casual conversations.',
    description_vi: 'Thành ngữ thông dụng, cụm động từ và cách diễn đạt trong đời sống.',
  },
];

export const seedFlashcards: SeedFlashcard[] = [
  // Business Topic
  {
    id: 'card-biz-1',
    topic_id: 'topic-business',
    word: 'Collaborate',
    part_of_speech: 'v.',
    phonetic: '/kəˈlæb.ə.reɪt/',
    definition_en: 'To work jointly on an activity or project, especially to produce or create something.',
    definition_vi: 'Hợp tác, cộng tác làm việc cùng nhau.',
    example_en: 'Our team will collaborate with the design department to launch the new application.',
    example_vi: 'Đội ngũ của chúng tôi sẽ hợp tác với bộ phận thiết kế để ra mắt ứng dụng mới.',
  },
  {
    id: 'card-biz-2',
    topic_id: 'topic-business',
    word: 'Negotiate',
    part_of_speech: 'v.',
    phonetic: '/nəˈɡoʊ.ʃi.eɪt/',
    definition_en: 'To obtain or bring about by discussion or bargaining.',
    definition_vi: 'Đàm phán, thương lượng.',
    example_en: 'She managed to negotiate a higher salary and better benefit packages.',
    example_vi: 'Cô ấy đã thành công đàm phán mức lương cao hơn và các gói phúc lợi tốt hơn.',
  },
  {
    id: 'card-biz-3',
    topic_id: 'topic-business',
    word: 'Redundant',
    part_of_speech: 'adj.',
    phonetic: '/rɪˈdʌn.dənt/',
    definition_en: 'Not or no longer needed or useful; superfluous; laid off from job.',
    definition_vi: 'Dư thừa; bị sa thải (do cắt giảm nhân sự).',
    example_en: 'Due to the economic downturn, several workers were made redundant.',
    example_vi: 'Do sự suy thoái kinh tế, một số công nhân đã bị cắt giảm nhân sự.',
  },
  {
    id: 'card-biz-4',
    topic_id: 'topic-business',
    word: 'Lucrative',
    part_of_speech: 'adj.',
    phonetic: '/ˈluː.krə.t̬ɪv/',
    definition_en: 'Producing a great deal of profit.',
    definition_vi: 'Có lời, sinh lợi nhiều.',
    example_en: 'Real estate investment can be highly lucrative if done carefully.',
    example_vi: 'Đầu tư bất động sản có thể sinh lời rất cao nếu thực hiện cẩn thận.',
  },
  {
    id: 'card-biz-5',
    topic_id: 'topic-business',
    word: 'Mitigate',
    part_of_speech: 'v.',
    phonetic: '/ˈmɪt̬.ə.ɡeɪt/',
    definition_en: 'To make something bad less severe, serious, or painful.',
    definition_vi: 'Giảm thiểu, làm nhẹ bớt mức độ nghiêm trọng.',
    example_en: 'The company implemented security measures to mitigate the risk of data breaches.',
    example_vi: 'Công ty đã triển khai các biện pháp bảo mật để giảm thiểu rủi ro rò rỉ dữ liệu.',
  },

  // Tech Topic
  {
    id: 'card-tech-1',
    topic_id: 'topic-technology',
    word: 'Algorithm',
    part_of_speech: 'n.',
    phonetic: '/ˈæl.ɡə.rɪ.ðəm/',
    definition_en: 'A process or set of rules to be followed in calculations or other problem-solving operations.',
    definition_vi: 'Thuật toán, quy trình giải quyết vấn đề bằng máy tính.',
    example_en: 'The social media feed algorithm customizes content based on user engagement.',
    example_vi: 'Thuật toán bảng tin mạng xã hội tự động tùy biến nội dung dựa trên tương tác người dùng.',
  },
  {
    id: 'card-tech-2',
    topic_id: 'topic-technology',
    word: 'Decentralized',
    part_of_speech: 'adj.',
    phonetic: '/diːˈsen.trə.laɪzd/',
    definition_en: 'Controlled by several local offices or authorities rather than one single one; distributed.',
    definition_vi: 'Phi tập trung, phân tán quyền quản lý.',
    example_en: 'Blockchain technology is based on a decentralized network ledger.',
    example_vi: 'Công nghệ blockchain hoạt động dựa trên một sổ cái mạng lưới phi tập trung.',
  },
  {
    id: 'card-tech-3',
    topic_id: 'topic-technology',
    word: 'Deprecate',
    part_of_speech: 'v.',
    phonetic: '/ˈdep.rə.keɪt/',
    definition_en: 'To express disapproval of; in software, to declare obsolete and warn against use.',
    definition_vi: 'Không khuyến khích sử dụng; (lập trình) khai tử, đánh dấu lỗi thời.',
    example_en: 'The developers decided to deprecate the old API in favor of the new GraphQL endpoint.',
    example_vi: 'Các lập trình viên đã quyết định khai tử API cũ để chuyển sang cổng GraphQL mới.',
  },
  {
    id: 'card-tech-4',
    topic_id: 'topic-technology',
    word: 'Scalability',
    part_of_speech: 'n.',
    phonetic: '/ˌskeɪ.ləˈbɪl.ə.t̬i/',
    definition_en: 'The capacity to be changed in size or scale to meet growing demands.',
    definition_vi: 'Khả năng mở rộng (hệ thống/quy mô).',
    example_en: 'Cloud computing provides startups with great scalability for their databases.',
    example_vi: 'Điện toán đám mây cung cấp cho các startup khả năng mở rộng dữ liệu tuyệt vời.',
  },

  // Travel Topic
  {
    id: 'card-trav-1',
    topic_id: 'topic-travel',
    word: 'Itinerary',
    part_of_speech: 'n.',
    phonetic: '/aɪˈtɪn.ə.rer.i/',
    definition_en: 'A planned route or journey details.',
    definition_vi: 'Lịch trình chuyến đi, lộ trình du lịch.',
    example_en: 'We prepared a detailed itinerary for our two-week vacation in Japan.',
    example_vi: 'Chúng tôi đã chuẩn bị một lịch trình chi tiết cho kỳ nghỉ hai tuần tại Nhật Bản.',
  },
  {
    id: 'card-trav-2',
    topic_id: 'topic-travel',
    word: 'Embark',
    part_of_speech: 'v.',
    phonetic: '/ɪmˈbɑːrk/',
    definition_en: 'To go on board a ship, aircraft, or other vehicle; to begin a course of action.',
    definition_vi: 'Lên tàu/máy bay; bắt đầu dấn thân vào một hành trình.',
    example_en: 'Passengers will embark on the cruise ship tomorrow morning.',
    example_vi: 'Hành khách sẽ lên tàu du thuyền vào sáng mai.',
  },
  {
    id: 'card-trav-3',
    topic_id: 'topic-travel',
    word: 'Hospitable',
    part_of_speech: 'adj.',
    phonetic: '/hɑːˈspɪt̬.ə.bəl/',
    definition_en: 'Friendly and welcoming to visitors or guests.',
    definition_vi: 'Hiếu khách, mến khách.',
    example_en: 'The local villagers were incredibly hospitable, offering us food and shelter.',
    example_vi: 'Người dân địa phương vô cùng hiếu khách, họ mời chúng tôi thức ăn và nơi trú ẩn.',
  },

  // Daily Topic
  {
    id: 'card-day-1',
    topic_id: 'topic-daily-life',
    word: 'Procrastinate',
    part_of_speech: 'v.',
    phonetic: '/proʊˈkræs.tə.neɪt/',
    definition_en: 'To delay or postpone action; put off doing something.',
    definition_vi: 'Trì hoãn, chần chừ khất lần.',
    example_en: 'If you procrastinate on your assignments, you will feel stressed later.',
    example_vi: 'Nếu bạn trì hoãn làm bài tập, bạn sẽ cảm thấy căng thẳng sau này.',
  },
  {
    id: 'card-day-2',
    topic_id: 'topic-daily-life',
    word: 'Vivid',
    part_of_speech: 'adj.',
    phonetic: '/ˈvɪv.ɪd/',
    definition_en: 'Producing powerful feelings or strong, clear images in the mind.',
    definition_vi: 'Sống động, đầy màu sắc, rõ nét trong tâm trí.',
    example_en: 'She gave a vivid description of her adventures in the Amazon jungle.',
    example_vi: 'Cô ấy đã đưa ra một mô tả vô cùng sống động về những cuộc phiêu lưu trong rừng Amazon.',
  },
  {
    id: 'card-day-3',
    topic_id: 'topic-daily-life',
    word: 'Accumulate',
    part_of_speech: 'v.',
    phonetic: '/əˈkjuː.mjə.leɪt/',
    definition_en: 'To gather together or acquire an increasing number or quantity of.',
    definition_vi: 'Tích lũy, gom góp lại nhiều dần.',
    example_en: 'You can accumulate frequent flyer miles by traveling with the same airline.',
    example_vi: 'Bạn có thể tích lũy dặm bay thường xuyên bằng cách bay cùng một hãng hàng không.',
  },
];
