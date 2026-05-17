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
Comment

GET
/api/comments
POST
/api/comments
PUT
/api/comments/{id}
DELETE
/api/comments/{id}
GET
/api/comments/by-job/{jobId}
Subcategory

GET
/api/subcategories
POST
/api/subcategories
GET
/api/subcategories/paginated-search
GET
/api/subcategories/{id}
PUT
/api/subcategories/{id}
DELETE
/api/subcategories/{id}
POST
/api/subcategories/create-group
POST
/api/subcategories/upload-image/{subcategoryId}
PUT
/api/subcategories/update-group/{id}
Job

GET
/api/jobs
POST
/api/jobs
GET
/api/jobs/paginated-search
GET
/api/jobs/{id}
PUT
/api/jobs/{id}
DELETE
/api/jobs/{id}
POST
/api/jobs/upload-image/{jobId}
GET
/api/jobs/category-menu
GET
/api/jobs/subcategories/by-category/{categoryId}
GET
/api/jobs/by-subcategory/{subcategoryId}
GET
/api/jobs/details/{jobId}
GET
/api/jobs/search/{name}
Category

GET
/api/categories
POST
/api/categories
GET
/api/categories/paginated-search
GET
/api/categories/{id}
PUT
/api/categories/{id}
DELETE
/api/categories/{id}
User

GET
/api/users
POST
/api/users
DELETE
/api/users
GET
/api/users/paginated-search
GET
/api/users/{id}
PUT
/api/users/{id}
GET
/api/users/search/{name}
POST
/api/users/upload-avatar
Skill

GET
/api/skill
Hire

GET
/api/hires
POST
/api/hires
GET
/api/hires/paginated-search
GET
/api/hires/{id}
PUT
/api/hires/{id}
DELETE
/api/hires/{id}
GET
/api/hires/my-hires
POST
/api/hires/complete/{hireId}
Models
ThongTinUser{
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
CommentViewModel{
id	integer($int32)
jobId integer($int32)
commenterId	integer($int32)
commentedAt string
content string
rating integer($int32)
}
SubcategoryView{
id	integer($int32)
name string
}
SubcategoryViewModel{
id integer($int32)
name	string
categoryId	integer($int32)
subcategories [...]
}
JobViewModel{
id integer($int32)
title	string
reviews	integer($int32)
price integer($int32)
creatorId	integer($int32)
image string
description string
subcategoryId integer($int32)
shortDescription	string
rating	integer($int32)
}
CategoryViewModel{
id integer($int32)
name	string
}
CapNhatUser{
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
HireViewModel{
id integer($int32)
jobId	integer($int32)
hirerId integer($int32)
hiredAt string
completed boolean
}
