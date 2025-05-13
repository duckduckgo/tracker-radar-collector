#!/usr/bin/env zx

const helpMessage = `
Usage: ./verify.mjs [options]

Options:
  --labels=PATH     Path to labels.json file (required)
  --country=CODE    Country code for results directory (required)
  --help            Display this help message
`;

// Display usage information if --help flag is provided
if (argv.help) {
    console.log(helpMessage);
    process.exit(0);
}

// Check for required arguments
if (!argv.labels || !argv.country) {
    console.error("Error: Missing required arguments.");
    console.log(helpMessage);
    process.exit(1);
}

// Use command-line arguments
const labelsPath = argv.labels;
const countryCode = argv.country;

export const DETECT_PATTERNS = [
    /accept cookies/gi,
    /accept all/gi,
    /reject all/gi,
    /only necessary cookies/gi, // "only necessary" is probably too broad
    /by clicking.*(accept|agree|allow)/gi,
    /by continuing/gi,
    /we (use|serve)( optional)? cookies/gi,
    /we are using cookies/gi,
    /use of cookies/gi,
    /(this|our) (web)?site.*cookies/gi,
    /cookies (and|or) .* technologies/gi,
    /such as cookies/gi,
    /read more about.*cookies/gi,
    /consent to.*cookies/gi,
    /we and our partners.*cookies/gi,
    /we.*store.*information.*such as.*cookies/gi,
    /store and\/or access information.*on a device/gi,
    /personalised ads and content, ad and content measurement/gi,

    // it might be tempting to add the patterns below, but they cause too many false positives. Don't do it :)
    // /cookies? settings/i,
    // /cookies? preferences/i,
];

export function checkHeuristicPatterns(allText) {
    for (const p of DETECT_PATTERNS) {
        const matches = allText?.match(p);
        if (matches) {
            return true;
        }
    }
    return false;
}

async function loadLabelsAndResults() {
    const labels = await fs.readJson(labelsPath);

    const results = {
        regex: {
            correct: 0,
            falsePositive: 0,
            falseNegative: 0,
            incorrectCases: [],
        },
        llm: {
            correct: 0,
            falsePositive: 0,
            falseNegative: 0,
            incorrectCases: [],
        },
    };

    for (const label of labels) {
        const basename = path.basename(label.image);
        const [, domain] = basename.match(/^(.+)_\w+\.jpg$/);
        const hasPopup = label.choice !== "no popup";

        const [crawlResultPath] = await glob(`results/${countryCode}/3p-crawl/${domain}*.json`,);
        if (!crawlResultPath) {continue;}

        const crawlResult = await fs.readJson(crawlResultPath);
        const [screenshotPath] = await glob(`results/${countryCode}/3p-crawl/${domain}*.jpg`,);

        // Get the cookiepopups data for detailed reporting
        const cookiePopups = crawlResult.data.cookiepopups;

        // Regex
        const regexMatch = cookiePopups.some(f => checkHeuristicPatterns(f.domText));
        evaluateDetection(results.regex, regexMatch, hasPopup, {
            domain,
            screenshot: screenshotPath,
            domText: cookiePopups
                .map(f => f.domText || "")
                .join("\n"),
            expected: hasPopup,
            detected: regexMatch,
        });

        // LLM
        const llmMatch = cookiePopups.some(f => f.llmMatch);
        evaluateDetection(results.llm, llmMatch, hasPopup, {
            domain,
            screenshot: screenshotPath,
            domText: cookiePopups
                .map(f => f.domText || "")
                .join("\n"),
            expected: hasPopup,
            detected: llmMatch,
        });
    }

    return results;
}

function evaluateDetection(
    resultObject,
    detectionMatch,
    hasPopup,
    caseDetails,
) {
    if (detectionMatch === hasPopup) {
        resultObject.correct++;
    } else if (detectionMatch && !hasPopup) {
        resultObject.falsePositive++;
        resultObject.incorrectCases.push({
            type: "falsePositive",
            ...caseDetails,
        });
    } else {
        resultObject.falseNegative++;
        resultObject.incorrectCases.push({
            type: "falseNegative",
            ...caseDetails,
        });
    }
}

function calculateMetrics(results) {
    for (const key in results) {
        const category = results[key];
        category.total =
            category.correct + category.falsePositive + category.falseNegative;
        category.accuracy = category.correct / category.total;
        category.precision =
            category.correct / (category.correct + category.falsePositive) || 0;
        category.recall =
            category.correct / (category.correct + category.falseNegative) || 0;

        if (category.precision > 0 && category.recall > 0) {
            category.f1Score =
                2 *
                ((category.precision * category.recall) /
                    (category.precision + category.recall));
        } else {
            category.f1Score = 0;
        }
    }
}

function displayResults(results) {
    console.log("Results:");

    for (const [key, result] of Object.entries(results)) {
        const formattedKey = key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, str => str.toUpperCase());

        console.log(`\n${formattedKey}:`);
        console.log(`  Correct: ${result.correct}`);
        console.log(`  False Positives: ${result.falsePositive} (Detected popup when none existed)`,);
        console.log(`  False Negatives: ${result.falseNegative} (Failed to detect existing popup)`,);
        console.log(`  Total: ${result.total}`);
        console.log(`  Accuracy: ${(result.accuracy * 100).toFixed(2)}%`);
        console.log(`  Precision: ${(result.precision * 100).toFixed(2)}%`);
        console.log(`  Recall: ${(result.recall * 100).toFixed(2)}%`);
        console.log(`  F1 Score: ${(result.f1Score * 100).toFixed(2)}%`);
    }
}

function generateHtmlReport(methodResult, method) {
    const incorrectCases = methodResult.incorrectCases;

    if (incorrectCases.length === 0) {
        console.log(`No incorrect cases found for ${method}`);
        return;
    }

    const methodDisplayName = method
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, str => str.toUpperCase());

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Debug Report - ${methodDisplayName}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        .case {
            display: none;
            border: 1px solid #ccc;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 5px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .case.active {
            display: block;
        }
        .case-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        .case-title {
            font-size: 1.5em;
            margin: 0;
        }
        .case-type {
            padding: 5px 10px;
            border-radius: 3px;
            color: white;
            font-weight: bold;
        }
        .false-positive {
            background-color: #e74c3c;
        }
        .false-negative {
            background-color: #3498db;
        }
        .screenshot {
            max-width: 100%;
            margin-bottom: 20px;
            border: 1px solid #eee;
        }
        .content-section {
            margin-bottom: 20px;
        }
        .section-title {
            font-weight: bold;
            margin-bottom: 5px;
        }
        pre {
            background-color: #f9f9f9;
            padding: 10px;
            border-radius: 5px;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
            font-size: 12px;
        }
        .navigation {
            display: flex;
            justify-content: space-between;
            margin: 20px 0;
        }
        button {
            padding: 8px 16px;
            background-color: #3498db;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
        }
        button:disabled {
            background-color: #ccc;
            cursor: not-allowed;
        }
        .case-counter {
            text-align: center;
            font-size: 16px;
            margin: 10px 0;
        }
        .summary {
            margin-bottom: 20px;
            background-color: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
        }
    </style>
</head>
<body>
    <h1>Debug Report - ${methodDisplayName}</h1>

    <div class="summary">
        <h2>Summary</h2>
        <p>Total incorrect cases: ${incorrectCases.length}</p>
        <p>False positives: ${methodResult.falsePositive}</p>
        <p>False negatives: ${methodResult.falseNegative}</p>
        <p>Accuracy: ${(methodResult.accuracy * 100).toFixed(2)}%</p>
        <p>Precision: ${(methodResult.precision * 100).toFixed(2)}%</p>
        <p>Recall: ${(methodResult.recall * 100).toFixed(2)}%</p>
        <p>F1 Score: ${(methodResult.f1Score * 100).toFixed(2)}%</p>
    </div>

    <div class="navigation">
        <button id="prevBtn" disabled>← Previous</button>
        <div class="case-counter">Case <span id="currentCase">1</span> of ${incorrectCases.length}</div>
        <button id="nextBtn" ${incorrectCases.length <= 1 ? "disabled" : ""}>Next →</button>
    </div>

    ${incorrectCases
        .map((caseData, index) => `
    <div class="case ${index === 0 ? "active" : ""}" data-index="${index}">
        <div class="case-header">
            <h2 class="case-title">${caseData.domain}</h2>
            <div class="case-type ${caseData.type === "falsePositive" ? "false-positive" : "false-negative"}">
                ${caseData.type === "falsePositive" ? "False Positive" : "False Negative"}
            </div>
        </div>

        <div class="content-section">
            <div class="section-title">Expected:</div>
            <div>${caseData.expected ? "Popup Present" : "No Popup"}</div>
        </div>

        <div class="content-section">
            <div class="section-title">Detected:</div>
            <div>${caseData.detected ? "Popup Present" : "No Popup"}</div>
        </div>

        ${
            caseData.screenshot
                ? `
        <div class="content-section">
            <div class="section-title">Screenshot:</div>
            <img class="screenshot" src="${caseData.screenshot}" alt="Screenshot of ${caseData.domain}">
        </div>`
                : ""
        }

        <div class="content-section">
            <div class="section-title">Document Text:</div>
            <pre>${escapeHtml(caseData.domText)}</pre>
        </div>
    </div>
    `,)
        .join("")}

    <script>
        // JavaScript for navigation
        document.addEventListener('DOMContentLoaded', function() {
            const cases = document.querySelectorAll('.case');
            const prevBtn = document.getElementById('prevBtn');
            const nextBtn = document.getElementById('nextBtn');
            const currentCaseSpan = document.getElementById('currentCase');
            let currentIndex = 0;

            function showCase(index) {
                // Hide all cases
                cases.forEach(c => c.classList.remove('active'));

                // Show the current case
                cases[index].classList.add('active');

                // Update counter
                currentCaseSpan.textContent = index + 1;

                // Update button states
                prevBtn.disabled = index === 0;
                nextBtn.disabled = index === cases.length - 1;
            }

            prevBtn.addEventListener('click', function() {
                if (currentIndex > 0) {
                    currentIndex--;
                    showCase(currentIndex);
                }
            });

            nextBtn.addEventListener('click', function() {
                if (currentIndex < cases.length - 1) {
                    currentIndex++;
                    showCase(currentIndex);
                }
            });

            // Initialize
            showCase(0);
        });

        // Also allow keyboard navigation
        document.addEventListener('keydown', function(e) {
            if (e.key === 'ArrowLeft') {
                document.getElementById('prevBtn').click();
            } else if (e.key === 'ArrowRight') {
                document.getElementById('nextBtn').click();
            }
        });
    </script>
</body>
</html>`;

    // Function to escape HTML special characters
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    const reportPath = `debug-report-${method}.html`;
    fs.writeFileSync(reportPath, html);
    console.log(`Report generated: ${reportPath}`);
}

// Main execution
const results = await loadLabelsAndResults();
calculateMetrics(results);
displayResults(results);

// Generate HTML report for the specified detection method
for (const detectionMethod of [
    "regex",
    "llm",
]) {
    generateHtmlReport(results[detectionMethod], detectionMethod);
}
