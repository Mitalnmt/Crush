# Crush

Extension Chrome hỗ trợ Crush: mở nhiều link, menu tiện ích trên trang khóa học, và các thao tác quiz/video nhanh hơn.

## Cài đặt

1. Mở Chrome → **Extensions** → bật **Developer mode**.
2. Chọn **Load unpacked** và trỏ tới thư mục dự án này.
3. Vào trang Coursera (`coursera.org`) — menu Crush xuất hiện góc dưới trái.

## Popup extension (icon Crush trên thanh công cụ)

| Mục | Mô tả |
|-----|--------|
| **Gemini API keys** | Thêm một hoặc nhiều key; extension tự đổi key khi hết quota. |
| **Model / GMN auto** | Chọn model Gemini; bật **GMN auto** để khi làm quiz có gợi ý đáp án từ AI (cần key). |
| **Đáp án quiz** | Mỗi dòng `số. đáp án` (vd. `1. c`, `4. a,b`). Dùng với **Copy quiz** / **Auto điền quiz**. |
| **Ẩn mục đã hoàn thành** | Ẩn dòng đã tick trên danh sách bài Coursera. |
| **Dán link / Mở tab** | Dán text có URL → phân tích → mở từng tab theo thứ tự. |
| **Hướng dẫn / Keymap** | Mở mục tương ứng trong popup để xem chức năng và chỉnh phím tắt. |

## Menu trên trang Coursera

Menu có thể **thu gọn** bằng icon Crush trên trang (thành nút tròn).

| Nút | Chức năng |
|-----|-----------|
| **Fast Quiz** | Chế độ làm quiz hàng loạt (nhảy bài, làm bài, nộp). Dừng bằng **Dừng** trên popup giữa màn hình khi đang chạy. |
| **Nhảy** | Chọn bài assignment/quiz chưa hoàn thành đầu tiên trong danh sách module. |
| **Quiz** | Lấy nội dung câu hỏi; kèm Gemini nếu đã bật GMN auto trong popup. |
| **Copy / Paste** | Copy câu hỏi ra clipboard; Paste điền đáp án từ ô menu hoặc clipboard rồi nộp. |
| **Skip** | Đánh dấu hoàn thành video/reading trong tuần đang xem. |

Phím tắt mặc định (có thể đổi trong **Keymap**): `Alt+J` Nhảy, `Alt+Q` Quiz, `Alt+V` Paste, `Alt+S` Skip, `Alt+F` Fast Quiz, `Alt+X` Dừng Fast Quiz, `Alt+C` Thu gọn menu.
