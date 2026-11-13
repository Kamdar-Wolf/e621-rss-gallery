import {expect,test} from "vitest";
import {compactCount,formatShortDate} from "./utils";
test("compactCount keeps basic totals",()=>{expect(compactCount(75)).toBe("75");expect(compactCount(-1)).toBe("0");});
test("invalid date is safely displayed",()=>{expect(formatShortDate("garbage")).toBe("Bez data");});
