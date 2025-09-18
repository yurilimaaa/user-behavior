/*

Tab: AB-Test-SI-RQ-Summary
Can we look at the code that was done in the 2 attached files and create the script on the vs code fil
----
1. We want to use the data on the attached js files to build this report 
2. I will add a daily trigger to update the file daily 
3. Start Date should be a easy cons to edit on the top of the code
4. Do not update the column names on row 1

---

totalUsers
- C2 = AB-Test-Inquiry-Request.js > Column B
- C3 = AB-Test-Inquiry-Request.js > Column E
- C4 = AB-Test-Inquiry-Request.js > Column H
- C5 = AB-Test-Inquiry-Request.js > Column M

Start
- D2 = AB-Test-Inquiry-Request.js > Column C
- D3 = AB-Test-Inquiry-Request.js > Column F
- D4 = AB-Test-Inquiry-Request.js > Column I
- D5 = AB-Test-Inquiry-Request.js > Column N

Submit
- E2 = AB-Test-Inquiry-Request.js > Column C & update the event from `inquiry_start` to `inquiry_submit_success'
- E3 = AB-Test-Inquiry-Request.js > Column F & update the event to `inquiry_submit_success'
- E4 = AB-Test-Inquiry-Request.js > Column I & update the event to `trip-cart_book-now-proceed-to-payment-cl`
- E5 = AB-Test-Inquiry-Request.js > Column N & update the event to `trip-cart_book-now-proceed-to-payment-cl`

Purchase
- F2 = AB-Test-Inquiry-Request.js > Column C & update the event from `inquiry_start` to `purchase' & add param = purchase_type + value =  marketplace
- F3 = AB-Test-Inquiry-Request.js > Column F & update the event to `purchase' & add param = purchase_type + value =  marketplace
- F4 = AB-Test-Inquiry-Request.js > Column I & update the event to `purchase' & add param = purchase_type + value = marketplace_instabook
- F5 = AB-Test-Inquiry-Request.js > Column N & update the event to  to `purchase' & add param = purchase_type + value = marketplace_instabook

 */

