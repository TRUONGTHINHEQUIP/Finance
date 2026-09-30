-- Sinh sẵn kế hoạch trả/nhập dựa trên đúng số liệu ĐANG TẠI DỰ ÁN hiện có (tính
-- từ phiếu giao nhận thật) — để có dữ liệu minh họa ngay, không phải gõ tay
-- từng dòng. Chủ động chỉ tạo cho ~75% số dòng (không phải 100%) để vẫn còn
-- một số dòng "chưa có kế hoạch trả" cho đúng thực tế và để thấy tính năng
-- nhắc nhở hoạt động.

create temporary table tmp_deployed as
select project_id, category_id, sum(delta) as qty
from (
  select tn.to_location_id as project_id, tni.category_id, coalesce(tni.sl_thuc_nhan, tni.sl_xuat) as delta
  from transfer_notes tn join transfer_note_items tni on tni.transfer_note_id = tn.id
  where tn.to_location_type = 'du_an' and tn.status = 'chinh_thuc' and tn.ngay_ky <= current_date
  union all
  select tn.from_location_id as project_id, tni.category_id, -coalesce(tni.sl_thuc_nhan, tni.sl_xuat) as delta
  from transfer_notes tn join transfer_note_items tni on tni.transfer_note_id = tn.id
  where tn.from_location_type = 'du_an' and tn.status = 'chinh_thuc' and tn.ngay_ky <= current_date
) x
group by project_id, category_id
having sum(delta) > 0;

-- Kế hoạch TRẢ VỀ — khoảng 75% số dòng, trả 30-100% số lượng đang có, ngày dự
-- kiến rải từ 1 tuần tới khoảng 6 tháng tới (giống thực tế: có dự án trả sớm,
-- có dự án giữ lâu).
insert into equipment_forecasts (project_id, category_id, plan_type, qty, expected_date, note, created_by, updated_by)
select
  project_id, category_id, 'tra',
  round(qty * (0.3 + random() * 0.7))::numeric,
  current_date + (interval '1 day' * (7 + floor(random() * 175))::int),
  'Ước tính ban đầu dựa trên dữ liệu hiện có — cần Sale xác nhận lại với công trình',
  (select id from profiles limit 1), (select id from profiles limit 1)
from tmp_deployed
where random() < 0.75;

-- Kế hoạch NHẬP THÊM — chỉ khoảng 15% số dòng (không phải dự án nào cũng đang
-- nhận thêm hàng), ngày dự kiến gần hơn (trong vòng 3 tháng tới).
insert into equipment_forecasts (project_id, category_id, plan_type, qty, expected_date, note, created_by, updated_by)
select
  project_id, category_id, 'nhap',
  round(qty * (0.2 + random() * 0.5))::numeric,
  current_date + (interval '1 day' * (5 + floor(random() * 85))::int),
  'Dự kiến công trình cần thêm — ước tính ban đầu',
  (select id from profiles limit 1), (select id from profiles limit 1)
from tmp_deployed
where random() < 0.15;

drop table tmp_deployed;
