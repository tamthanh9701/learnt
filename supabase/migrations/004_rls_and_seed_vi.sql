-- Migration 004: Enable RLS on reference tables + correct Vietnamese seed examples
-- Tier A remediation (task 20260530-0005-learnt-remediation). Forward, additive, idempotent.
-- Does NOT edit 001/002/003.

-- ============================================================================
-- CH1: Enable Row Level Security on topics + flashcards (BR-RLS)
-- 001 created "Anyone can read ..." SELECT policies but never ENABLEd RLS on
-- these two tables, leaving the policies inert and writes effectively open.
-- Enabling RLS with ONLY a SELECT using(true) policy makes them world-readable
-- and denies all client writes (anon + non-service authenticated) by default.
-- ALTER ... ENABLE is a no-op if already enabled (idempotent).
-- ============================================================================
alter table public.topics     enable row level security;
alter table public.flashcards enable row level security;

-- Re-affirm the read-only policies idempotently (drop-if-exists then create).
drop policy if exists "Anyone can read topics"     on public.topics;
drop policy if exists "Anyone can read flashcards"  on public.flashcards;
create policy "Anyone can read topics"     on public.topics     for select using (true);
create policy "Anyone can read flashcards"  on public.flashcards for select using (true);
-- NOTE: intentionally NO insert/update/delete policy -> all client writes denied.
-- Reference content is provisioned only via these migrations (service role).

-- ============================================================================
-- CH5: Correct example_vi (BR-SEED-VI)
-- 003 seeded example_vi with the English sentence (== example_en) for every card.
-- Source of truth = src/data/seedVocabulary.ts. Each UPDATE is guarded with
-- `is distinct from` so a re-run is a true no-op (idempotent, NFR-10).
-- ============================================================================
update public.flashcards set example_vi = 'Đội ngũ của chúng tôi sẽ hợp tác với bộ phận thiết kế để ra mắt ứng dụng mới.'
  where id = 'card-biz-1' and example_vi is distinct from 'Đội ngũ của chúng tôi sẽ hợp tác với bộ phận thiết kế để ra mắt ứng dụng mới.';
update public.flashcards set example_vi = 'Cô ấy đã thành công đàm phán mức lương cao hơn và các gói phúc lợi tốt hơn.'
  where id = 'card-biz-2' and example_vi is distinct from 'Cô ấy đã thành công đàm phán mức lương cao hơn và các gói phúc lợi tốt hơn.';
update public.flashcards set example_vi = 'Do sự suy thoái kinh tế, một số công nhân đã bị cắt giảm nhân sự.'
  where id = 'card-biz-3' and example_vi is distinct from 'Do sự suy thoái kinh tế, một số công nhân đã bị cắt giảm nhân sự.';
update public.flashcards set example_vi = 'Đầu tư bất động sản có thể sinh lời rất cao nếu thực hiện cẩn thận.'
  where id = 'card-biz-4' and example_vi is distinct from 'Đầu tư bất động sản có thể sinh lời rất cao nếu thực hiện cẩn thận.';
update public.flashcards set example_vi = 'Công ty đã triển khai các biện pháp bảo mật để giảm thiểu rủi ro rò rỉ dữ liệu.'
  where id = 'card-biz-5' and example_vi is distinct from 'Công ty đã triển khai các biện pháp bảo mật để giảm thiểu rủi ro rò rỉ dữ liệu.';
update public.flashcards set example_vi = 'Thuật toán bảng tin mạng xã hội tự động tùy biến nội dung dựa trên tương tác người dùng.'
  where id = 'card-tech-1' and example_vi is distinct from 'Thuật toán bảng tin mạng xã hội tự động tùy biến nội dung dựa trên tương tác người dùng.';
update public.flashcards set example_vi = 'Công nghệ blockchain hoạt động dựa trên một sổ cái mạng lưới phi tập trung.'
  where id = 'card-tech-2' and example_vi is distinct from 'Công nghệ blockchain hoạt động dựa trên một sổ cái mạng lưới phi tập trung.';
update public.flashcards set example_vi = 'Các lập trình viên đã quyết định khai tử API cũ để chuyển sang cổng GraphQL mới.'
  where id = 'card-tech-3' and example_vi is distinct from 'Các lập trình viên đã quyết định khai tử API cũ để chuyển sang cổng GraphQL mới.';
update public.flashcards set example_vi = 'Điện toán đám mây cung cấp cho các startup khả năng mở rộng dữ liệu tuyệt vời.'
  where id = 'card-tech-4' and example_vi is distinct from 'Điện toán đám mây cung cấp cho các startup khả năng mở rộng dữ liệu tuyệt vời.';
update public.flashcards set example_vi = 'Chúng tôi đã chuẩn bị một lịch trình chi tiết cho kỳ nghỉ hai tuần tại Nhật Bản.'
  where id = 'card-trav-1' and example_vi is distinct from 'Chúng tôi đã chuẩn bị một lịch trình chi tiết cho kỳ nghỉ hai tuần tại Nhật Bản.';
update public.flashcards set example_vi = 'Hành khách sẽ lên tàu du thuyền vào sáng mai.'
  where id = 'card-trav-2' and example_vi is distinct from 'Hành khách sẽ lên tàu du thuyền vào sáng mai.';
update public.flashcards set example_vi = 'Người dân địa phương vô cùng hiếu khách, họ mời chúng tôi thức ăn và nơi trú ẩn.'
  where id = 'card-trav-3' and example_vi is distinct from 'Người dân địa phương vô cùng hiếu khách, họ mời chúng tôi thức ăn và nơi trú ẩn.';
update public.flashcards set example_vi = 'Nếu bạn trì hoãn làm bài tập, bạn sẽ cảm thấy căng thẳng sau này.'
  where id = 'card-day-1' and example_vi is distinct from 'Nếu bạn trì hoãn làm bài tập, bạn sẽ cảm thấy căng thẳng sau này.';
update public.flashcards set example_vi = 'Cô ấy đã đưa ra một mô tả vô cùng sống động về những cuộc phiêu lưu trong rừng Amazon.'
  where id = 'card-day-2' and example_vi is distinct from 'Cô ấy đã đưa ra một mô tả vô cùng sống động về những cuộc phiêu lưu trong rừng Amazon.';
update public.flashcards set example_vi = 'Bạn có thể tích lũy dặm bay thường xuyên bằng cách bay cùng một hãng hàng không.'
  where id = 'card-day-3' and example_vi is distinct from 'Bạn có thể tích lũy dặm bay thường xuyên bằng cách bay cùng một hãng hàng không.';

-- ============================================================================
-- REVERSE NOTE (manual, run on a scratch/admin connection if rollback needed):
--   alter table public.topics     disable row level security;
--   alter table public.flashcards disable row level security;
-- The example_vi correction is forward-data-only: reversal intentionally leaves
-- the corrected Vietnamese in place (reverting to the wrong English values in
-- 003 is undesirable and unnecessary).
-- ============================================================================
