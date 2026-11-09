const contactRouteSelect = document.getElementById("contact-route");
const contactRouteInput = document.getElementById("result-contact-route");
const imageInput = document.getElementById("consultation-images");
const imageDropZone = document.getElementById("image-drop-zone");
const imagePreview = document.getElementById("image-preview");
const imageUploadStatus = document.getElementById("image-upload-status");
const ocrButton = document.getElementById("extract-image-info");
const ocrStatus = document.getElementById("ocr-status");
const recognizedTextInput = document.getElementById("recognized-text");
const reextractButton = document.getElementById("reextract-from-text");
const textExtractionStatus = document.getElementById("text-extraction-status");
const copyButton = document.getElementById("copy-to-excel");
const copyStatus = copyButton.closest("section").querySelector("p");
let uploadedImages = [];
let nextImageId = 0;
let dragDepth = 0;
let nextClipboardImageId = 0;
let ocrRunning = false;

const excelFieldIds = [
	"inquiry-date",
	"result-contact-route",
	"company-name",
	"contact-person",
	"phone",
	"email",
	"customer-category",
	"end-user",
	"equipment",
	"item",
	"gp",
	"unit-price",
	"quantity",
	"sales-price",
	"delivery-date",
	"won-lost",
	"quotation-purpose",
	"assignee",
];

const ocrFieldDefinitions = [
	{ id: "company-name", labels: ["업체명", "회사명", "기업명", "상호", "company name"] },
	{ id: "contact-person", labels: ["담당자 성함", "담당자명", "담당자", "contact person", "contact name"] },
	{ id: "phone", labels: ["전화번호", "전화", "연락처", "phone number", "telephone", "phone", "tel"], validate: isPhoneNumber },
	{ id: "email", labels: ["이메일", "전자우편", "e-mail", "e mail", "email address", "email"], validate: isEmailAddress },
	{ id: "end-user", labels: ["엔드유저", "end user", "최종 사용자", "최종사용자"] },
	{ id: "equipment", labels: ["적용 장비", "적용장비", "적용 설비", "적용설비", "application equipment", "application", "equipment"] },
	{ id: "item", labels: ["제품 형번", "제품 모델", "제품명", "품목명", "품목", "제품", "모델명", "형번", "품번", "part number", "part no.", "part no", "product name", "model", "product", "item"], product: true },
	{ id: "quantity", labels: ["필요 수량", "필요수량", "수량", "quantity", "qty"], validate: isQuantity },
	{ id: "unit-price", labels: ["vat 포함 단가", "단가 (vat 포함)", "단가(vat포함)", "단가", "unit price", "price per unit"], validate: isPrice },
	{ id: "sales-price", labels: ["판매가", "총 판매가", "selling price", "sales price"], validate: isPrice },
	{ id: "gp", labels: ["gp"] },
	{ id: "delivery-date", labels: ["납기일", "납기", "납품일", "delivery date", "delivery"] },
	{ id: "quotation-purpose", labels: ["견적목적", "견적 목적", "입찰 여부", "입찰여부", "용도", "quotation purpose", "tender purpose", "purpose"] },
	{ id: "assignee", labels: ["이관 대리점 또는 영업담당자", "이관 대리점", "이관 담당자", "영업 담당자", "영업담당자", "담당 대리점", "대리점", "sales representative", "sales rep", "dealer"] },
];

const allOcrLabels = ocrFieldDefinitions.flatMap((field) => field.labels);
const criticalOcrFieldIds = new Set(["item", "quantity", "phone"]);
const ocrReviewThreshold = 70;
const labelPatternSourceCache = new WeakMap();
const labeledFieldPatternCache = new WeakMap();

function setTodayDate() {
	const today = new Date();
	const year = today.getFullYear();
	const month = String(today.getMonth() + 1).padStart(2, "0");
	const day = String(today.getDate()).padStart(2, "0");

	document.getElementById("inquiry-date").value = `${year}-${month}-${day}`;
}

function isSupportedImage(file) {
	const supportedTypes = ["image/png", "image/jpeg", "image/webp"];
	const supportedExtensions = /\.(png|jpe?g|webp)$/i;

	return supportedTypes.includes(file.type) || (!file.type && supportedExtensions.test(file.name));
}

function renderImagePreviews() {
	imagePreview.replaceChildren();

	if (uploadedImages.length === 0) {
		const message = document.createElement("p");
		message.className = "preview-empty";
		message.textContent = "업로드한 이미지 미리보기 영역";
		imagePreview.append(message);
		return;
	}

	for (const uploadedImage of uploadedImages) {
		const { id, file, url } = uploadedImage;
		const preview = document.createElement("figure");
		preview.className = "preview-item";

		const image = document.createElement("img");
		image.src = url;
		image.alt = file.name;
		preview.append(image);

		const caption = document.createElement("figcaption");
		caption.textContent = file.name;
		preview.append(caption);

		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "image-remove-button";
		removeButton.dataset.imageId = String(id);
		removeButton.setAttribute("aria-label", `${file.name} 삭제`);
		removeButton.textContent = "×";
		preview.append(removeButton);

		imagePreview.append(preview);
	}
}

function addImages(files) {
	const acceptedFiles = [];
	let rejectedCount = 0;

	for (const file of files) {
		if (isSupportedImage(file)) {
			acceptedFiles.push(file);
		} else {
			rejectedCount += 1;
		}
	}

	for (const file of acceptedFiles) {
		const duplicate = uploadedImages.some((image) =>
			image.file.name === file.name &&
			image.file.size === file.size &&
			image.file.lastModified === file.lastModified
		);
		if (!duplicate) {
			uploadedImages.push({
				id: nextImageId++,
				file,
				url: URL.createObjectURL(file),
			});
		}
	}

	imageUploadStatus.textContent = rejectedCount > 0
		? "이미지가 아닌 파일은 제외했습니다. PNG, JPG, JPEG 또는 WEBP 이미지만 추가할 수 있습니다."
		: "";
	renderImagePreviews();
	ocrButton.disabled = uploadedImages.length === 0 || ocrRunning;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeLabelPattern(labels) {
	if (labelPatternSourceCache.has(labels)) {
		return labelPatternSourceCache.get(labels);
	}
	const pattern = labels
		.map((label) => label.normalize("NFKC").toLowerCase().replace(/[\s\u200b\uFEFF]/g, ""))
		.sort((first, second) => second.length - first.length)
		.map((label) => Array.from(label, escapeRegExp).join("[\\s\\u200b]*"))
		.join("|");
	labelPatternSourceCache.set(labels, pattern);
	return pattern;
}

function makeLabeledFieldPattern(labels) {
	if (!labeledFieldPatternCache.has(labels)) {
		labeledFieldPatternCache.set(labels, new RegExp(
			`(?:^|[\\s|•])(?:${makeLabelPattern(labels)})(?:\\s*#?\\d+)?(?:\\s*[（(][^()（）\\r\\n]*[）)])*\\.?\\s*[:：]`,
			"gi"
		));
	}
	const pattern = labeledFieldPatternCache.get(labels);
	pattern.lastIndex = 0;
	return pattern;
}

function extractLabeledValues(text, labels, preserveWhitespace = false) {
	const fieldPattern = makeLabeledFieldPattern(labels);
	const allFieldsPattern = makeLabeledFieldPattern(allOcrLabels);
	const values = [];

	for (const line of text.split(/\r?\n/)) {
		const nextLabelIndexes = [];
		for (const match of line.matchAll(allFieldsPattern)) {
			nextLabelIndexes.push(match.index);
		}

		for (const match of line.matchAll(fieldPattern)) {
			const valueStart = match.index + match[0].length;
			const nextLabelIndex = nextLabelIndexes.find((index) => index >= valueStart);
			const value = line
				.slice(valueStart, nextLabelIndex ?? line.length)
				.replace(/^[|•\s]+|[|•\s]+$/g, "")
				.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
				.trim();
			if (value && !/^[-–—]+$/.test(value)) {
				values.push(value);
			}
		}
	}

	const normalizedValues = values.map((value) => preserveWhitespace ? value : value.replace(/\s+/g, " "));
	return Array.from(new Set(normalizedValues));
}

function hasLabeledField(text, labels) {
	return makeLabeledFieldPattern(labels).test(text);
}

function findPhoneNumbers(text) {
	const phonePattern = /(?:^|[^\d])((?:02|0\d{2})[-.\s]?\d{3,4}[-.\s]?\d{4})(?!\d)/g;
	return Array.from(new Set(Array.from(text.matchAll(phonePattern), (match) => match[1])));
}

function normalizeKoreanPhone(value) {
	const digits = value.replace(/\D/g, "");
	if (digits.startsWith("02")) {
		const middle = digits.slice(2, -4);
		if ((middle.length === 3 || middle.length === 4) && digits.length >= 9 && digits.length <= 10) {
			return `02-${middle}-${digits.slice(-4)}`;
		}
	} else if (digits.startsWith("0") && (digits.length === 10 || digits.length === 11)) {
		const middle = digits.slice(3, -4);
		return `${digits.slice(0, 3)}-${middle}-${digits.slice(-4)}`;
	}
	return value.trim();
}

function isPhoneNumber(value) {
	return findPhoneNumbers(value).length === 1;
}

function isEmailAddress(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseQuantityValue(value) {
	const withUnit = value.match(/^\s*(\d+(?:[,.]\d+)?)\s*(?:개|ea|pcs)\s*[,;]?\s*$/i);
	if (withUnit) {
		return { value: withUnit[1], hasUnit: true, valid: true };
	}

	const bareNumber = value.match(/^\s*(\d+(?:[,.]\d+)?)\s*$/);
	if (bareNumber) {
		return { value: bareNumber[1], hasUnit: false, valid: true };
	}
	return { value: "", hasUnit: false, valid: false };
}

function isQuantity(value) {
	return parseQuantityValue(value).valid;
}

function isPrice(value) {
	return /^(?:[₩￦$]\s*)?\d[\d,.]*(?:\s*(?:원|krw))?$/i.test(value);
}

function isProductCandidate(value) {
	return /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣\s/-]*$/.test(value);
}

function getFieldConfidence(field, data) {
	const lines = Array.isArray(data.lines) ? data.lines : [];
	const matchingLines = lines.filter((line) => {
		if (hasLabeledField(line.text || "", field.labels)) {
			return true;
		}
		return field.id === "phone" && findPhoneNumbers(line.text || "").length > 0;
	});
	const lineConfidences = matchingLines
		.map((line) => line.confidence)
		.filter((confidence) => Number.isFinite(confidence));
	if (lineConfidences.length > 0) {
		return Math.min(...lineConfidences);
	}
	return Number.isFinite(data.confidence) ? data.confidence : null;
}

function extractRegionItemValue(text, field) {
	const prefixPattern = new RegExp(
		`^\\s*(?:${makeLabelPattern(field.labels)})(?:\\s*#?\\d+)?(?:\\s*[（(][^()（）\\r\\n]*[）)])*\\.?\\s*[:：]?\\s*(.*)$`,
		"i"
	);
	for (const line of text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
		const match = line.match(prefixPattern);
		const value = match ? match[1].trim() : line;
		if (value && !makeLabeledFieldPattern(allOcrLabels).test(line)) {
			return value;
		}
	}
	return "";
}

function parseFieldCandidate(field, data, { region = false, manual = false } = {}) {
	const text = data.text || "";
	const hasLabel = hasLabeledField(text, field.labels);
	let rawValues = extractLabeledValues(text, field.labels, field.id === "item");
	if (field.id === "phone" && rawValues.length === 0 && !hasLabel) {
		rawValues = findPhoneNumbers(text);
	}
	if (region && rawValues.length === 0) {
		if (field.id === "item") {
			const regionValue = extractRegionItemValue(text, field);
			if (regionValue) {
				rawValues = [regionValue];
			}
		} else if (field.id === "quantity") {
			const unitValues = Array.from(text.matchAll(/\d+(?:[,.]\d+)?\s*(?:개|ea|pcs)(?![A-Za-z])/gi), (match) => match[0].trim());
			if (unitValues.length > 0) {
				rawValues = unitValues;
			} else {
				const bareValues = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d+(?:[,.]\d+)?$/.test(line));
				rawValues = bareValues;
			}
		} else if (field.id === "phone") {
			rawValues = findPhoneNumbers(text);
		}
	}

	const evidence = {
		values: [],
		confidence: getFieldConfidence(field, data),
		hasLabel,
		hasEvidence: hasLabel || rawValues.length > 0,
		ambiguous: rawValues.length > 1,
		needsReview: false,
		hasUnit: false,
		valid: true,
	};

	if (field.id === "quantity") {
		const parsed = rawValues.map(parseQuantityValue);
		if (parsed.some((value) => !value.valid)) {
			evidence.needsReview = true;
			evidence.valid = false;
		} else if (parsed.length === 1) {
			evidence.values = [parsed[0].value];
			evidence.hasUnit = parsed[0].hasUnit;
			evidence.needsReview = !parsed[0].hasUnit && !manual;
		} else if (parsed.length > 1) {
			evidence.ambiguous = true;
		}
	} else if (field.id === "phone") {
		const phoneValues = rawValues.flatMap((value) => findPhoneNumbers(value));
		if (phoneValues.length === 1) {
			evidence.values = [normalizeKoreanPhone(phoneValues[0])];
		} else if (phoneValues.length > 1) {
			evidence.ambiguous = true;
		} else if (rawValues.length > 0) {
			evidence.needsReview = true;
			evidence.valid = false;
		}
	} else {
		evidence.values = rawValues;
		if (field.product && rawValues.some((value) => /[,;；]\s*\S/.test(value))) {
			evidence.ambiguous = true;
		}
		if (field.product && rawValues.some((value) => !isProductCandidate(value))) {
			evidence.needsReview = true;
			evidence.valid = false;
		}
		if (field.validate && rawValues.some((value) => !field.validate(value))) {
			evidence.needsReview = criticalOcrFieldIds.has(field.id);
			evidence.valid = false;
		}
	}

	if (!evidence.hasEvidence && region && evidence.values.length > 0) {
		evidence.hasEvidence = true;
	}
	return evidence;
}

function scoreFieldCandidate(field, data, { region = false } = {}) {
	const evidence = parseFieldCandidate(field, data, { region });
	let score = evidence.hasLabel ? 2 : 0;
	if (evidence.values.length === 1 && !evidence.ambiguous && evidence.valid) {
		score += 5;
	} else if (evidence.values.length > 0) {
		score += 1;
	}
	if (field.id === "quantity" && evidence.hasUnit) {
		score += 2;
	}
	if (Number.isFinite(evidence.confidence)) {
		score += evidence.confidence / 100;
	}
	if (region && evidence.values.length === 1 && evidence.valid) {
		score += 1;
	}
	return { ...evidence, score, data };
}

function scoreFullOcrResult(data) {
	return ocrFieldDefinitions.reduce((score, field) => {
		const candidate = scoreFieldCandidate(field, data);
		const weight = criticalOcrFieldIds.has(field.id) ? 2 : 1;
		return score + candidate.score * weight;
	}, 0);
}

function calculateOtsuThreshold(grayscaleValues, histogram) {
	let totalSum = 0;
	for (let value = 0; value < histogram.length; value += 1) {
		totalSum += value * histogram[value];
	}

	let backgroundWeight = 0;
	let backgroundSum = 0;
	let bestVariance = -1;
	let threshold = 127;
	for (let value = 0; value < histogram.length; value += 1) {
		backgroundWeight += histogram[value];
		if (backgroundWeight === 0) {
			continue;
		}
		const foregroundWeight = grayscaleValues.length - backgroundWeight;
		if (foregroundWeight === 0) {
			break;
		}
		backgroundSum += value * histogram[value];
		const backgroundMean = backgroundSum / backgroundWeight;
		const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
		const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
		if (variance > bestVariance) {
			bestVariance = variance;
			threshold = value;
		}
	}
	return threshold;
}

async function createPreprocessedCanvas(file, mode) {
	const image = await createImageBitmap(file);
	const scale = Math.max(image.width, image.height) <= 1000 ? 3 : 2;
	const canvas = document.createElement("canvas");
	canvas.width = image.width * scale;
	canvas.height = image.height * scale;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		image.close();
		throw new Error("Canvas context is unavailable");
	}
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(image, 0, 0, canvas.width, canvas.height);
	image.close();

	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	const grayscaleValues = new Uint8Array(canvas.width * canvas.height);
	const histogram = new Uint32Array(256);
	for (let pixel = 0; pixel < grayscaleValues.length; pixel += 1) {
		const offset = pixel * 4;
		const gray = Math.round(
			imageData.data[offset] * 0.299 +
			imageData.data[offset + 1] * 0.587 +
			imageData.data[offset + 2] * 0.114
		);
		grayscaleValues[pixel] = gray;
		histogram[gray] += 1;
	}

	const threshold = mode === "binary" ? calculateOtsuThreshold(grayscaleValues, histogram) : 0;
	for (let pixel = 0; pixel < grayscaleValues.length; pixel += 1) {
		const offset = pixel * 4;
		const gray = grayscaleValues[pixel];
		let output = gray;
		if (mode === "contrast") {
			output = Math.max(0, Math.min(255, Math.round((gray - 128) * 1.55 + 128)));
		} else {
			output = gray >= threshold ? 255 : 0;
		}
		imageData.data[offset] = output;
		imageData.data[offset + 1] = output;
		imageData.data[offset + 2] = output;
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}

function createRegionCanvas(sourceCanvas, bounds) {
	if (!bounds || !Number.isFinite(bounds.y0) || !Number.isFinite(bounds.y1)) {
		return null;
	}
	const padding = Math.max(12, Math.round((bounds.y1 - bounds.y0) * 0.75));
	const top = Math.max(0, Math.floor(bounds.y0 - padding));
	const bottom = Math.min(sourceCanvas.height, Math.ceil(bounds.y1 + padding));
	const regionHeight = bottom - top;
	if (regionHeight < 1) {
		return null;
	}

	const scale = 1.5;
	const canvas = document.createElement("canvas");
	canvas.width = Math.ceil(sourceCanvas.width * scale);
	canvas.height = Math.ceil(regionHeight * scale);
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";
	context.drawImage(sourceCanvas, 0, top, sourceCanvas.width, regionHeight, 0, 0, canvas.width, canvas.height);
	return canvas;
}

function findFieldLine(variants, field) {
	const matches = [];
	for (const variant of variants) {
		for (const line of variant.data.lines || []) {
			const lineText = line.text || "";
			const matchesField = hasLabeledField(lineText, field.labels) ||
				(field.id === "phone" && findPhoneNumbers(lineText).length > 0);
			if (matchesField && line.bbox) {
				matches.push({
					bounds: line.bbox,
					confidence: Number.isFinite(line.confidence) ? line.confidence : variant.data.confidence || 0,
				});
			}
		}
	}
	matches.sort((first, second) => second.confidence - first.confidence);
	return matches[0] || null;
}

async function extractCriticalRegionData(worker, imageRuns, reportProgress) {
	const criticalFields = ocrFieldDefinitions.filter((field) => criticalOcrFieldIds.has(field.id));
	const regionResults = Object.fromEntries(
		criticalFields.map((field) => [field.id, imageRuns.map(() => [])])
	);
	let regionCount = 0;

	for (let imageIndex = 0; imageIndex < imageRuns.length; imageIndex += 1) {
		const imageRun = imageRuns[imageIndex];
		for (const field of criticalFields) {
			const line = findFieldLine(imageRun.variants, field);
			if (!line) {
				continue;
			}
			for (const variant of imageRun.variants) {
				const region = createRegionCanvas(variant.canvas, line.bounds);
				if (!region) {
					continue;
				}
				reportProgress(`항목별 재인식 중... ${field.id} (${imageIndex + 1}/${imageRuns.length})`);
				const result = await worker.recognize(region);
				regionResults[field.id][imageIndex].push(result.data);
				regionCount += 1;
			}
		}
	}
	return { regionResults, regionCount };
}

function aggregateFieldEvidence(field, imageRuns, regionResults) {
	const selectedCandidates = [];
	for (let imageIndex = 0; imageIndex < imageRuns.length; imageIndex += 1) {
		const imageRun = imageRuns[imageIndex];
		const candidates = [scoreFieldCandidate(field, imageRun.best.data)];
		for (const regionData of regionResults[field.id]?.[imageIndex] || []) {
			candidates.push(scoreFieldCandidate(field, regionData, { region: true }));
		}
		candidates.sort((first, second) => second.score - first.score);
		if (candidates[0].hasEvidence || candidates[0].values.length > 0 || candidates[0].needsReview) {
			selectedCandidates.push(candidates[0]);
		}
	}

	const values = Array.from(new Set(selectedCandidates.flatMap((candidate) => candidate.values)));
	const confidences = selectedCandidates
		.filter((candidate) => candidate.values.length > 0)
		.map((candidate) => candidate.confidence);
	const confidence = confidences.length > 0 && confidences.every(Number.isFinite)
		? Math.min(...confidences)
		: null;
	return {
		values,
		confidence,
		hasEvidence: selectedCandidates.some((candidate) => candidate.hasEvidence),
		ambiguous: selectedCandidates.some((candidate) => candidate.ambiguous) || values.length > 1,
		needsReview: selectedCandidates.some((candidate) => candidate.needsReview),
		hasUnit: selectedCandidates.filter((candidate) => candidate.values.length > 0).every((candidate) => candidate.hasUnit),
		valid: selectedCandidates.every((candidate) => candidate.valid),
	};
}

function setFieldReviewStatus(fieldId, needsReview) {
	const badge = document.getElementById(`${fieldId}-review`);
	if (badge) {
		badge.hidden = !needsReview;
	}
}

function buildExtractionPlan(text, { fieldEvidence = {}, manual = false } = {}) {
	const updates = [];
	const reviewFieldIds = [];

	for (const field of ocrFieldDefinitions) {
		const evidence = fieldEvidence[field.id] || parseFieldCandidate(
			field,
			{ text, confidence: manual ? 100 : null },
			{ manual }
		);
		const isCritical = criticalOcrFieldIds.has(field.id);
		const lowConfidence = isCritical && evidence.hasEvidence && evidence.values.length > 0 &&
			!manual && (!Number.isFinite(evidence.confidence) || evidence.confidence < ocrReviewThreshold);
		const needsReview = evidence.ambiguous || evidence.needsReview || lowConfidence;
		setFieldReviewStatus(field.id, needsReview);
		if (needsReview && isCritical) {
			reviewFieldIds.push(field.id);
		}
		if (needsReview || !evidence.valid || evidence.values.length !== 1) {
			continue;
		}
		if (field.id === "quantity" && !evidence.hasUnit && !manual) {
			setFieldReviewStatus(field.id, true);
			reviewFieldIds.push(field.id);
			continue;
		}

		const input = document.getElementById(field.id);
		const value = evidence.values[0];
		if (field.validate && !field.validate(value)) {
			if (isCritical) {
				setFieldReviewStatus(field.id, true);
				reviewFieldIds.push(field.id);
			}
			continue;
		}
		if (input.value !== value) {
			updates.push({ id: field.id, value, previousValue: input.value });
		}
	}

	return { updates, reviewFieldIds: Array.from(new Set(reviewFieldIds)) };
}

function applyExtractionPlan(plan, { overwrite = false } = {}) {
	let filledCount = 0;
	for (const update of plan.updates) {
		const input = document.getElementById(update.id);
		if (!input.value.trim() || overwrite) {
			input.value = update.value;
			filledCount += 1;
		}
	}
	return filledCount;
}

function fillFieldsFromOcr(text, options = {}) {
	const plan = buildExtractionPlan(text, options);
	const filledCount = applyExtractionPlan(plan);
	return { filledCount, ambiguousFields: plan.reviewFieldIds };
}

function reextractFromEditedText() {
	const text = recognizedTextInput.value;
	if (!text.trim()) {
		textExtractionStatus.textContent = "먼저 인식된 텍스트를 입력해 주세요.";
		return;
	}

	const plan = buildExtractionPlan(text, { manual: true });
	const overwriteCount = plan.updates.filter((update) => update.previousValue.trim()).length;
	if (overwriteCount > 0 && !window.confirm(`기존 입력값 ${overwriteCount}개를 수정된 텍스트의 값으로 덮어쓸까요?`)) {
		textExtractionStatus.textContent = "기존 입력값을 유지했습니다.";
		return;
	}

	const filledCount = applyExtractionPlan(plan, { overwrite: true });
	textExtractionStatus.textContent = `수정된 텍스트에서 ${filledCount}개 항목을 반영했습니다.${plan.reviewFieldIds.length ? " 확인이 필요한 항목은 표시해 두었습니다." : ""}`;
}

async function extractInformationFromImages() {
	if (ocrRunning || uploadedImages.length === 0) {
		return;
	}
	if (!window.Tesseract) {
		ocrStatus.textContent = "OCR 엔진을 불러오지 못했습니다. 인터넷 연결 후 페이지를 새로고침해 주세요.";
		return;
	}

	ocrRunning = true;
	ocrButton.disabled = true;
	recognizedTextInput.value = "";
	textExtractionStatus.textContent = "";
	for (const fieldId of criticalOcrFieldIds) {
		setFieldReviewStatus(fieldId, false);
	}
	const imagesToProcess = uploadedImages.slice();
	const imageRuns = [];
	const criticalFields = ocrFieldDefinitions.filter((field) => criticalOcrFieldIds.has(field.id));
	const regionResults = Object.fromEntries(criticalFields.map((field) => [field.id, []]));
	let regionCount = 0;
	let worker;

	try {
		ocrStatus.textContent = "이미지 분석 중... OCR 엔진을 준비하고 있습니다.";
		worker = await window.Tesseract.createWorker("kor+eng", 1, {
			logger: (message) => {
				if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
					const percent = Math.round(message.progress * 100);
					ocrStatus.textContent = `이미지 분석 중... (${imageRuns.length + 1}/${imagesToProcess.length}, ${percent}%)`;
				}
			},
		});

		for (let index = 0; index < imagesToProcess.length; index += 1) {
			ocrStatus.textContent = `이미지 전처리 중... (${index + 1}/${imagesToProcess.length})`;
			const contrastCanvas = await createPreprocessedCanvas(imagesToProcess[index].file, "contrast");
			const binaryCanvas = await createPreprocessedCanvas(imagesToProcess[index].file, "binary");
			const variants = [
				{ name: "대비 강화", canvas: contrastCanvas },
				{ name: "이진화", canvas: binaryCanvas },
			];

			for (const variant of variants) {
				ocrStatus.textContent = `이미지 분석 중... (${index + 1}/${imagesToProcess.length}, ${variant.name})`;
				const result = await worker.recognize(variant.canvas);
				variant.data = result.data;
				variant.score = scoreFullOcrResult(result.data);
			}

			variants.sort((first, second) => {
				const scoreDifference = second.score - first.score;
				if (scoreDifference !== 0) {
					return scoreDifference;
				}
				return (second.data.confidence || 0) - (first.data.confidence || 0);
			});
			const imageRun = { variants, best: variants[0] };
			const perImageRegions = await extractCriticalRegionData(
				worker,
				[imageRun],
				(message) => { ocrStatus.textContent = message; }
			);
			for (const field of criticalFields) {
				regionResults[field.id].push(perImageRegions.regionResults[field.id][0]);
			}
			regionCount += perImageRegions.regionCount;

			const storedVariants = variants.map(({ name, data, score }) => ({ name, data, score }));
			const bestVariant = storedVariants.find((variant) => variant.name === variants[0].name);
			imageRuns.push({ variants: storedVariants, best: bestVariant });
			for (const variant of variants) {
				variant.canvas.width = 0;
				variant.canvas.height = 0;
			}
			recognizedTextInput.value = imageRuns
				.map((run, imageIndex) => `[이미지 ${imageIndex + 1} · ${run.best.name}]\n${(run.best.data.text || "").trim()}`)
				.join("\n\n");
		}

		const fieldEvidence = Object.fromEntries(
			ocrFieldDefinitions
				.filter((field) => criticalOcrFieldIds.has(field.id))
				.map((field) => [field.id, aggregateFieldEvidence(field, imageRuns, regionResults)])
		);
		const plan = buildExtractionPlan(recognizedTextInput.value, { fieldEvidence });
		const filledCount = applyExtractionPlan(plan);
		if (filledCount === 0 && plan.reviewFieldIds.length === 0) {
			ocrStatus.textContent = "분석이 완료되었습니다. 명확하게 확인된 항목이 없어 입력란은 변경하지 않았습니다.";
		} else {
			ocrStatus.textContent = `분석이 완료되었습니다. 전처리 비교와 ${regionCount}개 항목 영역 재인식을 마쳤고, 비어 있던 입력란 ${filledCount}개를 채웠습니다.${plan.reviewFieldIds.length ? " 확인 필요 표시된 항목은 자동 확정하지 않았습니다." : ""}`;
		}
	} catch (error) {
		console.error("OCR processing failed", error);
		ocrStatus.textContent = "OCR 처리에 실패했습니다. 이미지 형식과 브라우저 메모리를 확인한 뒤 다시 시도해 주세요.";
	} finally {
		if (worker) {
			try {
				await worker.terminate();
			} catch (error) {
				console.warn("OCR worker cleanup failed", error);
			}
		}
		ocrRunning = false;
		ocrButton.disabled = uploadedImages.length === 0;
	}
}

function handleImageDrop(event) {
	event.preventDefault();
	dragDepth = 0;
	imageDropZone.classList.remove("is-dragging");
	addImages(Array.from(event.dataTransfer.files));
}

function handleImagePaste(event) {
	const clipboardItems = Array.from(event.clipboardData?.items ?? []);
	const imageFiles = clipboardItems
		.filter((item) => item.kind === "file" && isSupportedImage({ type: item.type, name: "" }))
		.map((item) => item.getAsFile())
		.filter(Boolean)
		.map((file) => {
			const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
			const filename = `clipboard-image-${Date.now()}-${nextClipboardImageId++}.${extension}`;
			return new File([file], filename, { type: file.type, lastModified: Date.now() });
		});

	if (imageFiles.length > 0) {
		event.preventDefault();
		addImages(imageFiles);
	}
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
	const row = excelFieldIds
		.map((id) => document.getElementById(id).value)
		.join("\t");

	try {
		if (navigator.clipboard && window.isSecureContext) {
			try {
				await navigator.clipboard.writeText(row);
			} catch {
				if (!copyWithFallback(row)) {
					throw new Error("Clipboard copy failed");
				}
			}
		} else if (!copyWithFallback(row)) {
			throw new Error("Clipboard copy failed");
		}
		copyStatus.textContent = "복사되었습니다. Excel의 빈 행 첫 번째 셀에 붙여넣으세요.";
	} catch {
		copyStatus.textContent = "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.";
	}
}

setTodayDate();
contactRouteInput.value = contactRouteSelect.value;
contactRouteSelect.addEventListener("change", () => {
	contactRouteInput.value = contactRouteSelect.value;
});
imageInput.addEventListener("change", () => {
	addImages(Array.from(imageInput.files));
	imageInput.value = "";
});
imageDropZone.addEventListener("dragenter", (event) => {
	event.preventDefault();
	dragDepth += 1;
	imageDropZone.classList.add("is-dragging");
});
imageDropZone.addEventListener("dragover", (event) => {
	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "copy";
	}
});
imageDropZone.addEventListener("dragleave", (event) => {
	event.preventDefault();
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) {
		imageDropZone.classList.remove("is-dragging");
	}
});
imageDropZone.addEventListener("drop", handleImageDrop);
document.addEventListener("paste", handleImagePaste);
imagePreview.addEventListener("click", (event) => {
	const removeButton = event.target.closest("[data-image-id]");
	if (!removeButton) {
		return;
	}

	const imageId = Number(removeButton.dataset.imageId);
	const imageIndex = uploadedImages.findIndex((image) => image.id === imageId);
	if (imageIndex !== -1) {
		URL.revokeObjectURL(uploadedImages[imageIndex].url);
		uploadedImages.splice(imageIndex, 1);
		renderImagePreviews();
		ocrButton.disabled = uploadedImages.length === 0 || ocrRunning;
	}
});
ocrButton.addEventListener("click", extractInformationFromImages);
reextractButton.addEventListener("click", reextractFromEditedText);
for (const fieldId of criticalOcrFieldIds) {
	document.getElementById(fieldId).addEventListener("input", () => setFieldReviewStatus(fieldId, false));
}
copyButton.addEventListener("click", copyInquiryToClipboard);
