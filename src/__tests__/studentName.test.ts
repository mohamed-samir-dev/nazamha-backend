import { validStudentName } from "../utils/studentName";
describe("student name policy", () => {
  test.each(["أحمد محمد", "  مُحَمَّد   علي  ", "John Smith", "عبد الرحمن محمود"])("accepts %s", name => expect(validStudentName(name)).toBe(true));
  test.each(["123", "أحمد", "أحمد 123", "أحمد محمد١", "John @Smith", "", null, 123, "أ".repeat(121) + " ب"])("rejects %s", name => expect(validStudentName(name)).toBe(false));
});
