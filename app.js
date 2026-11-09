const contactRouteSelect = document.getElementById("contact-route");
const contactRouteInput = document.getElementById("result-contact-route");
const consultationText = document.getElementById("consultation-text");
const extractionStatus = document.getElementById("text-extraction-status");
const copyStatus = document.getElementById("copy-status");

const fieldDefinitions = [
	{ id: "inquiry-date", labels: ["연락일", "연락 날짜", "상담일", "contact date"], normalize: normalizeDate },
	{ id: "result-contact-route", labels: ["contact route", "연락 경로", "상담 경로", "문의 경로"] },
	{ id: "company-name", labels: ["업체명", "회사명", "기업명", "상호", "company name"] },
	{ id: "contact-person", labels: ["담당자 성함", "담당자명", "담당자", "contact person", "contact name"] },
	{ id: "phone", labels: ["전화번호", "전화", "연락처", "phone number", "telephone", "phone", "tel"], normalize: normalizePhone },
	{ id: "email", labels: ["이메일", "전자우편", "e-mail", "email address", "email"], normalize: normalizeEmail },
	{ id: "customer-category", labels: ["고객분류", "고객 분류", "customer category"] },
	{ id: "end-user", labels: ["엔드유저", "end user", "최종 사용자", "최종사용자"] },
	{ id: "equipment", labels: ["적용 장비", "적용장비", "적용 설비", "application equipment", "application", "equipment"] },
	{ id: "item", labels: ["제품 형번", "제품형번", "제품명", "품목", "형번", "품번", "모델명", "part number", "part no.", "part no"] },
	{ id: "gp", labels: ["gp"] },
	{ id: "unit-price", labels: ["단가(VAT포함)", "단가 (VAT 포함)", "VAT 포함 단가", "단가", "unit price"] },
	{ id: "quantity", labels: ["필요 수량", "필요수량", "수량", "quantity", "qty"], normalize: normalizeQuantity },
	{ id: "sales-price", labels: ["판매가", "총 판매가", "selling price", "sales price"] },
	{ id: "delivery-date", labels: ["납기일", "납기", "납품일", "delivery date", "delivery"] },
	{ id: "won-lost", labels: ["won/lost", "won / lost", "수주 결과"], normalize: normalizeWonLost },
	{ id: "quotation-purpose", labels: ["견적목적 (입찰 여부)", "견적목적", "견적 목적", "입찰 여부", "입찰여부", "용도", "quotation purpose"] },
	{ id: "assignee", labels: ["이관 대리점 또는 영업담당자", "이관 대리점", "이관 담당자", "영업 담당자", "영업담당자", "담당 대리점", "대리점", "sales representative"] },
];

const excelFieldIds = fieldDefinitions.map((field) => field.id);
const labelEntries = fieldDefinitions.flatMap((field) => field.labels.map((label) => ({
	id: field.id,
	key: label.toLowerCase().replace(/\s/g, ""),
	label,
}))).sort((first, second) => second.label.length - first.label.length);
const labelOwners = new Map(labelEntries.map((entry) => [entry.key, entry.id]));
const labelSource = labelEntries.map((entry) => Array.from(entry.label.replace(/\s/g, ""),
	(character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
).join("[^\\S\\r\\n\\u2028\\u2029]*")).join("|");
const labelPattern = new RegExp(`(^|[\\s,;|•])(${labelSource})[\x60*]*(?:[^\\S\\r\\n\\u2028\\u2029]*[:：=][^\\S\\r\\n\\u2028\\u2029]*|[^\\S\\r\\n\\u2028\\u2029]+(?=[^\\s:：=]))`, "gi");

function todayDate() {
	const today = new Date();
	return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function normalizeDate(value) {
	const match = value.match(/^(\d{4})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*일?\.?$/);
	if (!match) return "";
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
	return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeQuantity(value) {
	const match = value.match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:개|ea|pcs)?$/i);
	return match ? match[1].replace(/,/g, "") : "";
}

function normalizeEmail(value) {
	return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : "";
}

function findPhoneNumbers(text) {
	return Array.from(text.matchAll(/(?:^|[^\dA-Za-z])((?:02|0\d{2})[-. \t]?\d{3,4}[-. \t]?\d{4})(?![\dA-Za-z])/g), (match) => match[1]);
}

function normalizePhone(value) {
	const numbers = Array.from(new Set(findPhoneNumbers(value)));
	return numbers.length === 1 ? numbers[0] : "";
}

function normalizeWonLost(value) {
	if (/^won$/i.test(value)) return "Won";
	if (/^lost$/i.test(value)) return "Lost";
	return "";
}

function extractInformation(text) {
	const candidates = new Map(fieldDefinitions.map((field) => [field.id, []]));
	for (const rawLine of text.split(/\r\n|[\r\n\u2028\u2029]/)) {
		const line = rawLine.trim()
			.replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, "")
			.replace(/^[`*"'“‘]+|[`*"'”’]+$/g, "")
			.trim();
		const matches = Array.from(line.matchAll(labelPattern));
		for (const [index, match] of matches.entries()) {
			const id = labelOwners.get(match[2].toLowerCase().replace(/\s/g, ""));
			const value = line.slice(match.index + match[0].length, matches[index + 1]?.index ?? line.length)
				.replace(/^[\s,;|•`*"'“”‘’]+|[\s,;|•`*"'“”‘’]+$/g, "");
			candidates.get(id).push(value);
		}
	}

	if (candidates.get("email").length === 0) {
		candidates.set("email", text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []);
	}
	if (!candidates.get("phone").some((value) => normalizePhone(value))) {
		candidates.set("phone", findPhoneNumbers(text));
	}

	return fieldDefinitions.map((field) => {
		const values = candidates.get(field.id).map((value) => {
			if (/^(?:|[-–—]+|미정|미확인|알 수 없음|없음|unknown|n\/a|tbd|확인 필요)$/i.test(value)) return "";
			return field.normalize ? field.normalize(value) : value;
		});
		const uniqueValues = Array.from(new Set(values));
		return { id: field.id, value: uniqueValues.length === 1 ? uniqueValues[0] : "" };
	});
}

function fillFieldsFromText() {
	console.log("Extract button clicked");
	const text = consultationText.value;
	console.log("Consultation textarea text:", text);
	if (!text.trim()) {
		extractionStatus.textContent = "상담 내용을 입력해 주세요.";
		return;
	}
	const results = extractInformation(text);
	console.log("Parsed extraction results:", Object.fromEntries(results.map((result) => [result.id, result.value])));
	for (const result of results) {
		const input = document.getElementById(result.id);
		if (!input) {
			console.error("Extraction field ID not found:", result.id);
			throw new Error(`Extraction field ID not found: ${result.id}`);
		}
		input.value = result.value;
		console.log("Extraction field updated:", { id: input.id, value: input.value });
	}
	const dateResult = results.find((result) => result.id === "inquiry-date");
	if (!dateResult.value) document.getElementById("inquiry-date").value = todayDate();
	if (contactRouteSelect.value) contactRouteInput.value = contactRouteSelect.value;
	extractionStatus.textContent = `${results.filter((result) => result.value).length}개 항목을 추출했습니다.`;
	copyStatus.textContent = "";
}

function copyWithFallback(text) {
	const temporaryInput = document.createElement("textarea");
	temporaryInput.value = text;
	temporaryInput.setAttribute("readonly", "");
	temporaryInput.style.position = "fixed";
	temporaryInput.style.opacity = "0";
	document.body.append(temporaryInput);
	temporaryInput.select();
	const copied = document.execCommand("copy");
	temporaryInput.remove();
	return copied;
}

async function copyInquiryToClipboard() {
	const row = excelFieldIds.map((id) => document.getElementById(id).value.replace(/[\t\r\n]+/g, " ")).join("\t");
	try {
		if (navigator.clipboard && window.isSecureContext) {
			try {
				await navigator.clipboard.writeText(row);
			} catch {
				if (!copyWithFallback(row)) throw new Error("Clipboard copy failed");
			}
		} else if (!copyWithFallback(row)) {
			throw new Error("Clipboard copy failed");
		}
		copyStatus.textContent = "복사되었습니다. Excel의 빈 행 첫 번째 셀에 붙여넣으세요.";
	} catch {
		copyStatus.textContent = "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.";
	}
}

document.getElementById("inquiry-date").value = todayDate();
contactRouteInput.value = contactRouteSelect.value;
contactRouteSelect.addEventListener("change", () => {
	contactRouteInput.value = contactRouteSelect.value;
});
document.getElementById("extract-info").addEventListener("click", fillFieldsFromText);
document.getElementById("copy-to-excel").addEventListener("click", copyInquiryToClipboard);
document.getElementById("inquiry-form").addEventListener("submit", (event) => event.preventDefault());