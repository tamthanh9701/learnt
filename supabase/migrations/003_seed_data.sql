-- Seed topics
INSERT INTO public.topics (id, name_en, name_vi, description_en, description_vi, icon, difficulty_level, display_order)
VALUES
  ('topic-business', 'Business English', 'Tiếng Anh Thương Mại', 'Essential vocabulary for workplace, meetings, and business communication.', 'Từ vựng thiết yếu cho công sở, cuộc họp và giao tiếp kinh doanh.', '💼', 2, 1),
  ('topic-technology', 'Technology & AI', 'Công Nghệ & Trí Tuệ Nhân Tạo', 'Learn terms about computer science, software development, and AI trends.', 'Học các thuật ngữ về khoa học máy tính, phát triển phần mềm và xu hướng AI.', '💻', 2, 2),
  ('topic-travel', 'Travel & Tourism', 'Du Lịch & Khám Phá', 'Vocabulary for airports, hotels, directions, and ordering food.', 'Từ vựng hữu ích tại sân bay, khách sạn, hỏi đường và gọi món ăn.', '✈️', 1, 3),
  ('topic-daily-life', 'Daily Expressions', 'Giao Tiếp Hàng Ngày', 'Common idioms, phrasal verbs, and expressions for casual conversations.', 'Thành ngữ thông dụng, cụm động từ và cách diễn đạt trong đời sống.', '🗣️', 1, 4)
ON CONFLICT (id) DO NOTHING;

-- Seed flashcards
INSERT INTO public.flashcards (id, topic_id, word, part_of_speech, phonetic, definition_en, definition_vi, example_en, example_vi, display_order)
VALUES
  -- Business Topic
  ('card-biz-1', 'topic-business', 'Collaborate', 'v.', '/kəˈlæb.ə.reɪt/', 'To work jointly on an activity or project, especially to produce or create something.', 'Hợp tác, cộng tác làm việc cùng nhau.', 'Our team will collaborate with the design department to launch the new application.', 'Our team will collaborate with the design department to launch the new application.', 1),
  ('card-biz-2', 'topic-business', 'Negotiate', 'v.', '/nəˈɡoʊ.ʃi.eɪt/', 'To obtain or bring about by discussion or bargaining.', 'Đàm phán, thương lượng.', 'She managed to negotiate a higher salary and better benefit packages.', 'She managed to negotiate a higher salary and better benefit packages.', 2),
  ('card-biz-3', 'topic-business', 'Redundant', 'adj.', '/rɪˈdʌn.dənt/', 'Not or no longer needed or useful; superfluous; laid off from job.', 'Dư thừa; bị sa thải (do cắt giảm nhân sự).', 'Due to the economic downturn, several workers were made redundant.', 'Due to the economic downturn, several workers were made redundant.', 3),
  ('card-biz-4', 'topic-business', 'Lucrative', 'adj.', '/ˈluː.krə.t̬ɪv/', 'Producing a great deal of profit.', 'Có lời, sinh lợi nhiều.', 'Real estate investment can be highly lucrative if done carefully.', 'Real estate investment can be highly lucrative if done carefully.', 4),
  ('card-biz-5', 'topic-business', 'Mitigate', 'v.', '/ˈmɪt̬.ə.ɡeɪt/', 'To make something bad less severe, serious, or painful.', 'Giảm thiểu, làm nhẹ bớt mức độ nghiêm trọng.', 'The company implemented security measures to mitigate the risk of data breaches.', 'The company implemented security measures to mitigate the risk of data breaches.', 5),

  -- Tech Topic
  ('card-tech-1', 'topic-technology', 'Algorithm', 'n.', '/ˈæl.ɡə.rɪ.ðəm/', 'A process or set of rules to be followed in calculations or other problem-solving operations.', 'Thuật toán, quy trình giải quyết vấn đề bằng máy tính.', 'The social media feed algorithm customizes content based on user engagement.', 'The social media feed algorithm customizes content based on user engagement.', 1),
  ('card-tech-2', 'topic-technology', 'Decentralized', 'adj.', '/diːˈsen.trə.laɪzd/', 'Controlled by several local offices or authorities rather than one single one; distributed.', 'Phi tập trung, phân tán quyền quản lý.', 'Blockchain technology is based on a decentralized network ledger.', 'Blockchain technology is based on a decentralized network ledger.', 2),
  ('card-tech-3', 'topic-technology', 'Deprecate', 'v.', '/ˈdep.rə.keɪt/', 'To express disapproval of; in software, to declare obsolete and warn against use.', 'Không khuyến khích sử dụng; (lập trình) khai tử, đánh dấu lỗi thời.', 'The developers decided to deprecate the old API in favor of the new GraphQL endpoint.', 'The developers decided to deprecate the old API in favor of the new GraphQL endpoint.', 3),
  ('card-tech-4', 'topic-technology', 'Scalability', 'n.', '/ˌskeɪ.ləˈbɪl.ə.t̬i/', 'The capacity to be changed in size or scale to meet growing demands.', 'Khả năng mở rộng (hệ thống/quy mô).', 'Cloud computing provides startups with great scalability for their databases.', 'Cloud computing provides startups with great scalability for their databases.', 4),

  -- Travel Topic
  ('card-trav-1', 'topic-travel', 'Itinerary', 'n.', '/aɪˈtɪn.ə.rer.i/', 'A planned route or journey details.', 'Lịch trình chuyến đi, lộ trình du lịch.', 'We prepared a detailed itinerary for our two-week vacation in Japan.', 'We prepared a detailed itinerary for our two-week vacation in Japan.', 1),
  ('card-trav-2', 'topic-travel', 'Embark', 'v.', '/ɪmˈbɑːrk/', 'To go on board a ship, aircraft, or other vehicle; to begin a course of action.', 'Lên tàu/máy bay; bắt đầu dấn thân vào một hành trình.', 'Passengers will embark on the cruise ship tomorrow morning.', 'Passengers will embark on the cruise ship tomorrow morning.', 2),
  ('card-trav-3', 'topic-travel', 'Hospitable', 'adj.', '/hɑːˈspɪt̬.ə.bəl/', 'Friendly and welcoming to visitors or guests.', 'Hiếu khách, mến khách.', 'The local villagers were incredibly hospitable, offering us food and shelter.', 'The local villagers were incredibly hospitable, offering us food and shelter.', 3),

  -- Daily Topic
  ('card-day-1', 'topic-daily-life', 'Procrastinate', 'v.', '/proʊˈkræs.tə.neɪt/', 'To delay or postpone action; put off doing something.', 'Trì hoãn, chần chừ khất lần.', 'If you procrastinate on your assignments, you will feel stressed later.', 'If you procrastinate on your assignments, you will feel stressed later.', 1),
  ('card-day-2', 'topic-daily-life', 'Vivid', 'adj.', '/ˈvɪv.ɪd/', 'Producing powerful feelings or strong, clear images in the mind.', 'Sống động, đầy màu sắc, rõ nét trong tâm trí.', 'She gave a vivid description of her adventures in the Amazon jungle.', 'She gave a vivid description of her adventures in the Amazon jungle.', 2),
  ('card-day-3', 'topic-daily-life', 'Accumulate', 'v.', '/əˈkjuː.mjə.leɪt/', 'To gather together or acquire an increasing number or quantity of.', 'Tích lũy, gom góp lại nhiều dần.', 'You can accumulate frequent flyer miles by traveling with the same airline.', 'You can accumulate frequent flyer miles by traveling with the same airline.', 3)
ON CONFLICT (id) DO NOTHING;
