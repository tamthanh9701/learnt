-- Migration 005: Service-role seed of topics + flashcards.
--
-- CH7 (2026-06-07, P1-#3 follow-up): migration 004 enabled RLS on
-- public.topics and public.flashcards with ONLY a SELECT policy
-- (`Anyone can read topics`, `Anyone can read flashcards`).
-- Reference content was always intended to be provisioned via
-- service_role, but the in-app seedDatabaseIfNeeded() (which
-- runs as the authenticated user) is now blocked by RLS. The
-- CH4 error path surfaces this as a 'seed_failed' VocabError
-- with an RLS hint, but a fresh Supabase deployment has no way
-- to seed without this migration.
--
-- This migration re-asserts the reference content idempotently.
-- It does NOT edit 001-004. The values match 003 exactly (with
-- the example_vi fix from commit 74ac799's CH7 work), so a
-- re-run is a true no-op for already-correct data.
--
-- DEPLOY POSTURE: this migration must be run by the project
-- OWNER against the production database. The agent cannot
-- deploy it (Supabase MCP does not have access to the LearnT
-- project; see audit-report-2026-06-07 §1.5 / §3.4).
--
-- Run via Supabase SQL editor OR supabase CLI:
--   supabase db push  (with this migration in supabase/migrations/)
-- OR paste the body into the Supabase SQL editor and execute.

INSERT INTO public.topics (id, name_en, name_vi, description_en, description_vi, icon, difficulty_level, display_order)
VALUES
  ('topic-business', 'Business English', 'Tiếng Anh Thương Mại', 'Essential vocabulary for workplace, meetings, and business communication.', 'Từ vựng thiết yếu cho công sở, cuộc họp và giao tiếp kinh doanh.', '💼', 2, 1),
  ('topic-technology', 'Technology & AI', 'Công Nghệ & Trí Tuệ Nhân Tạo', 'Learn terms about computer science, software development, and AI trends.', 'Học các thuật ngữ về khoa học máy tính, phát triển phần mềm và xu hướng AI.', '💻', 2, 2),
  ('topic-travel', 'Travel & Tourism', 'Du Lịch & Khám Phá', 'Vocabulary for airports, hotels, directions, and ordering food.', 'Từ vựng hữu ích tại sân bay, khách sạn, hỏi đường và gọi món ăn.', '✈️', 1, 3),
  ('topic-daily-life', 'Daily Expressions', 'Giao Tiếp Hàng Ngày', 'Common idioms, phrasal verbs, and expressions for casual conversations.', 'Thành ngữ thông dụng, cụm động từ và cách diễn đạt trong đời sống.', '🗣️', 1, 4)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.flashcards (id, topic_id, word, part_of_speech, phonetic, definition_en, definition_vi, example_en, example_vi, display_order)
VALUES
  -- Business Topic
  ('card-biz-1', 'topic-business', 'Collaborate', 'v.', '/kəˈlæb.ə.reɪt/', 'To work jointly on an activity or project, especially to produce or create something.', 'Hợp tác, cộng tác làm việc cùng nhau.', 'Our team will collaborate with the design department to launch the new application.', 'Đội ngũ của chúng tôi sẽ hợp tác với bộ phận thiết kế để ra mắt ứng dụng mới.', 1),
  ('card-biz-2', 'topic-business', 'Negotiate', 'v.', '/nəˈɡoʊ.ʃi.eɪt/', 'To obtain or bring about by discussion or bargaining.', 'Đàm phán, thương lượng.', 'She managed to negotiate a higher salary and better benefit packages.', 'Cô ấy đã thành công đàm phán mức lương cao hơn và các gói phúc lợi tốt hơn.', 2),
  ('card-biz-3', 'topic-business', 'Redundant', 'adj.', '/rɪˈdʌn.dənt/', 'Not or no longer needed or useful; superfluous; laid off from job.', 'Dư thừa; bị sa thải (do cắt giảm nhân sự).', 'Due to the economic downturn, several workers were made redundant.', 'Do sự suy thoái kinh tế, một số công nhân đã bị cắt giảm nhân sự.', 3),
  ('card-biz-4', 'topic-business', 'Lucrative', 'adj.', '/ˈluː.krə.t̬ɪv/', 'Producing a great deal of profit.', 'Có lời, sinh lợi nhiều.', 'Real estate investment can be highly lucrative if done carefully.', 'Đầu tư bất động sản có thể sinh lời rất cao nếu thực hiện cẩn thận.', 4),
  ('card-biz-5', 'topic-business', 'Mitigate', 'v.', '/ˈmɪt̬.ə.ɡeɪt/', 'To make something bad less severe, serious, or painful.', 'Giảm thiểu, làm nhẹ bớt mức độ nghiêm trọng.', 'The company implemented security measures to mitigate the risk of data breaches.', 'Công ty đã triển khai các biện pháp bảo mật để giảm thiểu rủi ro rò rỉ dữ liệu.', 5),

  -- Tech Topic
  ('card-tech-1', 'topic-technology', 'Algorithm', 'n.', '/ˈæl.ɡə.rɪ.ðəm/', 'A process or set of rules to be followed in calculations or other problem-solving operations.', 'Thuật toán, quy trình giải quyết vấn đề bằng máy tính.', 'The social media feed algorithm customizes content based on user engagement.', 'Thuật toán bảng tin mạng xã hội tự động tùy biến nội dung dựa trên tương tác người dùng.', 1),
  ('card-tech-2', 'topic-technology', 'Decentralized', 'adj.', '/diːˈsen.trə.laɪzd/', 'Controlled by several local offices or authorities rather than one single one; distributed.', 'Phi tập trung, phân tán quyền quản lý.', 'Blockchain technology is based on a decentralized network ledger.', 'Công nghệ blockchain hoạt động dựa trên một sổ cái mạng lưới phi tập trung.', 2),
  ('card-tech-3', 'topic-technology', 'Deprecate', 'v.', '/ˈdep.rə.keɪt/', 'To express disapproval of; in software, to declare obsolete and warn against use.', 'Không khuyến khích sử dụng; (lập trình) khai tử, đánh dấu lỗi thời.', 'The developers decided to deprecate the old API in favor of the new GraphQL endpoint.', 'Các lập trình viên đã quyết định khai tử API cũ để chuyển sang cổng GraphQL mới.', 3),
  ('card-tech-4', 'topic-technology', 'Scalability', 'n.', '/ˌskeɪ.ləˈbɪl.ə.t̬i/', 'The capacity to be changed in size or scale to meet growing demands.', 'Khả năng mở rộng (hệ thống/quy mô).', 'Cloud computing provides startups with great scalability for their databases.', 'Điện toán đám mây cung cấp cho các startup khả năng mở rộng dữ liệu tuyệt vời.', 4),

  -- Travel Topic
  ('card-trav-1', 'topic-travel', 'Itinerary', 'n.', '/aɪˈtɪn.ə.rer.i/', 'A planned route or journey details.', 'Lịch trình chuyến đi, lộ trình du lịch.', 'We prepared a detailed itinerary for our two-week vacation in Japan.', 'Chúng tôi đã chuẩn bị một lịch trình chi tiết cho kỳ nghỉ hai tuần tại Nhật Bản.', 1),
  ('card-trav-2', 'topic-travel', 'Embark', 'v.', '/ɪmˈbɑːrk/', 'To go on board a ship, aircraft, or other vehicle; to begin a course of action.', 'Lên tàu/máy bay; bắt đầu dấn thân vào một hành trình.', 'Passengers will embark on the cruise ship tomorrow morning.', 'Hành khách sẽ lên tàu du thuyền vào sáng mai.', 2),
  ('card-trav-3', 'topic-travel', 'Hospitable', 'adj.', '/hɑːˈspɪt̬.ə.bəl/', 'Friendly and welcoming to visitors or guests.', 'Hiếu khách, mến khách.', 'The local villagers were incredibly hospitable, offering us food and shelter.', 'Người dân địa phương vô cùng hiếu khách, họ mời chúng tôi thức ăn và nơi trú ẩn.', 3),

  -- Daily Topic
  ('card-day-1', 'topic-daily-life', 'Procrastinate', 'v.', '/proʊˈkræs.tə.neɪt/', 'To delay or postpone action; put off doing something.', 'Trì hoãn, chần chừ khất lần.', 'If you procrastinate on your assignments, you will feel stressed later.', 'Nếu bạn trì hoãn làm bài tập, bạn sẽ cảm thấy căng thẳng sau này.', 1),
  ('card-day-2', 'topic-daily-life', 'Vivid', 'adj.', '/ˈvɪv.ɪd/', 'Producing powerful feelings or strong, clear images in the mind.', 'Sống động, đầy màu sắc, rõ nét trong tâm trí.', 'She gave a vivid description of her adventures in the Amazon jungle.', 'Cô ấy đã đưa ra một mô tả vô cùng sống động về những cuộc phiêu lưu trong rừng Amazon.', 2),
  ('card-day-3', 'topic-daily-life', 'Accumulate', 'v.', '/əˈkjuː.mjə.leɪt/', 'To gather together or acquire an increasing number or quantity of.', 'Tích lũy, gom góp lại nhiều dần.', 'You can accumulate frequent flyer miles by traveling with the same airline.', 'Bạn có thể tích lũy dặm bay thường xuyên bằng cách bay cùng một hãng hàng không.', 3)
ON CONFLICT (id) DO NOTHING;
