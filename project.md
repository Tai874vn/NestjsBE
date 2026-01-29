• Quy tắc đặt tên: tên biến (Camel Case), tên hàm (Camel Case), tên lớp đối tượng (Pascal Case)
• Chia chuẩn thư mục
• Quy tắc của hàm: kích thước nhỏ, chỉ làm một việc, tên dễ hiểu, chỉ nên có ít đối số. Nếu code dài nên tách thành
nhiều hàm độc lập
• Quy tắc comment:

- Code nên dễ hiểu để không lệ thuộc nhiều vào comment.
- Không comment dư thừa.
- Không comment những điều quá rõ ràng, dễ nhận biết.
- Không comment khi đóng thẻ/ngoặc
- Không comment đoạn code không còn sử dụng, xóa nó luôn.
- Comment để làm rõ ý nghĩa của code (logic phức tạp).
  • Không dư thừa biến: biến, tham số khi khai báo thì phải dùng tới
  • Không lặp lại code

Auth

POST
/api/auth/signup
POST
/api/auth/signin
BinhLuan

GET
/api/binh-luan
POST
/api/binh-luan
PUT
/api/binh-luan/{id}
DELETE
/api/binh-luan/{id}
GET
/api/binh-luan/lay-binh-luan-theo-cong-viec/{MaCongViec}
ChiTietLoaiCongViec

GET
/api/chi-tiet-loai-cong-viec
POST
/api/chi-tiet-loai-cong-viec
GET
/api/chi-tiet-loai-cong-viec/phan-trang-tim-kiem
GET
/api/chi-tiet-loai-cong-viec/{id}
PUT
/api/chi-tiet-loai-cong-viec/{id}
DELETE
/api/chi-tiet-loai-cong-viec/{id}
POST
/api/chi-tiet-loai-cong-viec/them-nhom-chi-tiet-loai
POST
/api/chi-tiet-loai-cong-viec/upload-hinh-nhom-loai-cong-viec/{MaNhomLoaiCongViec}
PUT
/api/chi-tiet-loai-cong-viec/sua-nhom-chi-tiet-loai/{id}
CongViec

GET
/api/cong-viec
POST
/api/cong-viec
GET
/api/cong-viec/phan-trang-tim-kiem
GET
/api/cong-viec/{id}
PUT
/api/cong-viec/{id}
DELETE
/api/cong-viec/{id}
POST
/api/cong-viec/upload-hinh-cong-viec/{MaCongViec}
GET
/api/cong-viec/lay-menu-loai-cong-viec
GET
/api/cong-viec/lay-chi-tiet-loai-cong-viec/{MaLoaiCongViec}
GET
/api/cong-viec/lay-cong-viec-theo-chi-tiet-loai/{MaChiTietLoai}
GET
/api/cong-viec/lay-cong-viec-chi-tiet/{MaCongViec}
GET
/api/cong-viec/lay-danh-sach-cong-viec-theo-ten/{TenCongViec}
LoaiCongViec

GET
/api/loai-cong-viec
POST
/api/loai-cong-viec
GET
/api/loai-cong-viec/phan-trang-tim-kiem
GET
/api/loai-cong-viec/{id}
PUT
/api/loai-cong-viec/{id}
DELETE
/api/loai-cong-viec/{id}
NguoiDung

GET
/api/users
POST
/api/users
DELETE
/api/users
GET
/api/users/phan-trang-tim-kiem
GET
/api/users/{id}
PUT
/api/users/{id}
GET
/api/users/search/{TenNguoiDung}
POST
/api/users/upload-avatar
Skill

GET
/api/skill
ThueCongViec

GET
/api/thue-cong-viec
POST
/api/thue-cong-viec
GET
/api/thue-cong-viec/phan-trang-tim-kiem
GET
/api/thue-cong-viec/{id}
PUT
/api/thue-cong-viec/{id}
DELETE
/api/thue-cong-viec/{id}
GET
/api/thue-cong-viec/lay-danh-sach-da-thue
POST
/api/thue-cong-viec/hoan-thanh-cong-viec/{MaThueCongViec}
Models
ThongTinNguoiDung{
id integer($int32)
name	string
email	string
password	string
phone	string
birthday	string
gender	boolean
role	string
skill	[...]
certification	[...]
}
DangNhapView{
email	string
password	string
}
BinhLuanViewModel{
id	integer($int32)
maCongViec integer($int32)
maNguoiBinhLuan	integer($int32)
ngayBinhLuan string
noiDung string
saoBinhLuan integer($int32)
}
ChiTietLoaiView{
id	integer($int32)
tenChiTiet string
}
ChiTietLoaiCongViecViewModel{
id integer($int32)
tenChiTiet	string
maLoaiCongViec	integer($int32)
danhSachChiTiet [...]
}
CongViecViewModel{
id integer($int32)
tenCongViec	string
danhGia	integer($int32)
giaTien integer($int32)
nguoiTao	integer($int32)
hinhAnh string
moTa string
maChiTietLoaiCongViec integer($int32)
moTaNgan	string
saoCongViec	integer($int32)
}
LoaiCongViecViewModel{
id integer($int32)
tenLoaiCongViec	string
}
CapNhatNguoiDung{
id	integer($int32)
name string
email string
phone string
birthday string
gender boolean
role string
skill [...]
certification [...]
}
ThueCongViecViewModel{
id integer($int32)
maCongViec	integer($int32)
maNguoiThue integer($int32)
ngayThue string
hoanThanh boolean
}
