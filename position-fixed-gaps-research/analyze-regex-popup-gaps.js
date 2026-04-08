#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { promises: fsp } = require('fs');
const asyncLib = require('async');

const DEFAULT_INPUT_DIR = '/mnt/efs/shared/crawler-data/autoconsent-coverage-crawls/2026-03-04/US/3p-crawl';
const DEFAULT_OUTPUT_FILE = path.join(__dirname, 'regex-popup-gap-report.json');
const DEFAULT_SAMPLE_LIMIT = 200;
const DEFAULT_PROGRESS_EVERY = 5000;
const TOP_LIMIT = 20;

function getDefaultConcurrency() {
    if (typeof os.availableParallelism === 'function') {
        return Math.max(1, Math.min(os.availableParallelism(), 32));
    }
    return Math.max(1, Math.min(os.cpus().length, 32));
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        inputPath: DEFAULT_INPUT_DIR,
        outputPath: DEFAULT_OUTPUT_FILE,
        sampleLimit: DEFAULT_SAMPLE_LIMIT,
        concurrency: getDefaultConcurrency(),
        progressEvery: DEFAULT_PROGRESS_EVERY,
    };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        const next = args[i + 1];
        if (arg === '--input' && next) {
            options.inputPath = next;
            i += 1;
        } else if (arg === '--output' && next) {
            options.outputPath = next;
            i += 1;
        } else if (arg === '--samples' && next) {
            const n = Number.parseInt(next, 10);
            if (!Number.isNaN(n) && n >= 0) {
                options.sampleLimit = n;
            }
            i += 1;
        } else if (arg === '--concurrency' && next) {
            const n = Number.parseInt(next, 10);
            if (!Number.isNaN(n) && n >= 1) {
                options.concurrency = n;
            }
            i += 1;
        } else if (arg === '--progress-every' && next) {
            const n = Number.parseInt(next, 10);
            if (!Number.isNaN(n) && n >= 1) {
                options.progressEvery = n;
            }
            i += 1;
        } else if (arg === '--help' || arg === '-h') {
            printHelpAndExit(0);
        }
    }

    return options;
}

function printHelpAndExit(code) {
    console.log('Analyze frame-level regex popup gaps.');
    console.log('');
    console.log('Usage:');
    console.log('  node analyze-regex-popup-gaps.js [--input <path>] [--output <path>] [--samples <n>] [--concurrency <n>] [--progress-every <n>]');
    console.log('');
    console.log('Options:');
    console.log(`  --input           Crawl JSON file or directory (default: ${DEFAULT_INPUT_DIR})`);
    console.log(`  --output          Report JSON path (default: ${DEFAULT_OUTPUT_FILE})`);
    console.log(`  --samples         Max stored gap examples (default: ${DEFAULT_SAMPLE_LIMIT})`);
    console.log(`  --concurrency     Parallel file workers (default: ${getDefaultConcurrency()})`);
    console.log(`  --progress-every  Log every N processed files (default: ${DEFAULT_PROGRESS_EVERY})`);
    process.exit(code);
}

function clipText(text) {
    if (typeof text !== 'string') {
        return '';
    }
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > 200 ? `${compact.slice(0, 200)}...` : compact;
}

function ratio(numerator, denominator) {
    if (!denominator) {
        return 0;
    }
    return Number((numerator / denominator).toFixed(6));
}

function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
}

/**
 * Flat discovery only:
 * - if input is file: use it
 * - if input is directory: scan direct children only
 */
async function collectJsonFiles(inputPath) {
    const stats = await fsp.stat(inputPath);
    if (stats.isFile()) {
        return inputPath.endsWith('.json') ? [inputPath] : [];
    }

    console.log(`Discovering JSON files in direct children of: ${inputPath}`);
    const jsonFiles = [];
    let scanned = 0;
    const startedAt = Date.now();
    const dir = await fsp.opendir(inputPath);

    for await (const entry of dir) {
        scanned += 1;
        if (entry.isFile() && entry.name.endsWith('.json')) {
            jsonFiles.push(path.join(inputPath, entry.name));
        }
        if (scanned === 1 || scanned % 10000 === 0) {
            const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
            const rate = (scanned / elapsedSec).toFixed(1);
            console.log(`[discovery] scanned=${scanned} jsonFiles=${jsonFiles.length} entries/s=${rate}`);
        }
    }

    console.log(`Discovery done in ${formatDuration(Date.now() - startedAt)}.`);
    return jsonFiles;
}

async function analyzeFile(filePath) {
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        const crawl = JSON.parse(raw);
        const frames = crawl?.data?.cookiepopups?.scrapedFrames;
        const cmps = Array.isArray(crawl?.data?.cookiepopups?.cmps) ? crawl.data.cookiepopups.cmps : [];
        const cmpWithNameCount = cmps.filter((cmp) => typeof cmp?.name === 'string' && cmp.name.trim() !== '').length;

        if (!Array.isArray(frames)) {
            return {
                filePath,
                host: path.basename(filePath).split('_')[0] || '',
                skippedNoFrames: true,
                cmpsCount: cmps.length,
                cmpWithNameCount,
                siteHasPopup: cmpWithNameCount > 0,
                isGapSite: false,
                frameCount: 0,
                frameRegexDetectedCount: 0,
                frameRegexWithoutPopupRegexCount: 0,
                potentialPopupCount: 0,
                popupRegexMatchCount: 0,
                frameGapDetails: [],
            };
        }

        const result = {
            filePath,
            host: path.basename(filePath).split('_')[0] || '',
            skippedNoFrames: false,
            cmpsCount: cmps.length,
            cmpWithNameCount,
            siteHasPopup: false,
            isGapSite: false,
            frameCount: 0,
            frameRegexDetectedCount: 0,
            frameRegexWithoutPopupRegexCount: 0,
            potentialPopupCount: 0,
            popupRegexMatchCount: 0,
            frameGapDetails: [],
        };

        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
            const frame = frames[frameIndex];
            const potentialPopups = Array.isArray(frame?.potentialPopups) ? frame.potentialPopups : [];
            const popupRegexMatches = potentialPopups.filter((popup) => popup?.regexMatch === true);
            const frameRegexDetected = frame?.regexPopupDetected === true;

            result.frameCount += 1;
            result.potentialPopupCount += potentialPopups.length;
            result.popupRegexMatchCount += popupRegexMatches.length;
            if (frameRegexDetected) {
                result.frameRegexDetectedCount += 1;
            }

            if (frameRegexDetected && popupRegexMatches.length === 0) {
                result.frameRegexWithoutPopupRegexCount += 1;
                result.frameGapDetails.push({
                    frameIndex,
                    origin: typeof frame?.origin === 'string' ? frame.origin : '',
                    isTop: frame?.isTop === true,
                    potentialPopupCount: potentialPopups.length,
                    popupTextPreview: clipText(potentialPopups[0]?.text),
                });
            }
        }

        const hasFrameRegexDetected = result.frameRegexDetectedCount > 0;
        const hasPopupLevelRegexDetection = result.popupRegexMatchCount > 0;

        result.siteHasPopup = hasFrameRegexDetected || result.cmpWithNameCount > 0;
        result.isGapSite = hasFrameRegexDetected && cmpWithNameCount === 0 && !hasPopupLevelRegexDetection;

        return result;
    } catch (error) {
        return {
            filePath,
            host: path.basename(filePath).split('_')[0] || '',
            error: error.message,
            skippedNoFrames: false,
            cmpsCount: 0,
            cmpWithNameCount: 0,
            siteHasPopup: false,
            isGapSite: false,
            frameCount: 0,
            frameRegexDetectedCount: 0,
            frameRegexWithoutPopupRegexCount: 0,
            potentialPopupCount: 0,
            popupRegexMatchCount: 0,
            frameGapDetails: [],
        };
    }
}

async function main() {
    const { inputPath, outputPath, sampleLimit, concurrency, progressEvery } = parseArgs();
    const startedAt = Date.now();

    let jsonFiles;
    try {
        jsonFiles = await collectJsonFiles(inputPath);
    } catch (error) {
        console.error(`Cannot read input path: ${error.message}`);
        process.exit(1);
    }

    console.log(`JSON files found: ${jsonFiles.length}`);
    console.log(`Concurrency: ${concurrency}`);

    const summary = {
        totalJsonFiles: jsonFiles.length,
        processedFiles: 0,
        filesWithErrors: 0,
        filesWithoutScrapedFrames: 0,
        sitesWithPopupByDefinition: 0,
        sitesWithFrameRegexDetected: 0,
        sitesWithCmpName: 0,
        sitesWithCmpsEmpty: 0,
        gapSites: 0,
        totalFrames: 0,
        totalFramesWithRegexPopupDetected: 0,
        totalCmpsEntries: 0,
        totalCmpsWithName: 0,
        totalFramesWithRegexButNoPopupRegex: 0,
        totalPotentialPopups: 0,
        totalPopupRegexMatches: 0,
    };

    const errors = [];
    const gapSitesExamples = [];
    const gapOriginCounts = {};
    const gapSitesByFrameCount = [];

    const parallel = Math.min(concurrency, Math.max(1, jsonFiles.length));
    await asyncLib.eachOfLimit(jsonFiles, parallel, async (filePath) => {
        const stats = await analyzeFile(filePath);
        summary.processedFiles += 1;
        summary.totalFrames += stats.frameCount;
        summary.totalCmpsEntries += stats.cmpsCount;
        summary.totalCmpsWithName += stats.cmpWithNameCount;
        summary.totalFramesWithRegexPopupDetected += stats.frameRegexDetectedCount;
        summary.totalFramesWithRegexButNoPopupRegex += stats.frameRegexWithoutPopupRegexCount;
        summary.totalPotentialPopups += stats.potentialPopupCount;
        summary.totalPopupRegexMatches += stats.popupRegexMatchCount;

        if (stats.skippedNoFrames) {
            summary.filesWithoutScrapedFrames += 1;
        }
        if (stats.error) {
            summary.filesWithErrors += 1;
            if (errors.length < 1000) {
                errors.push({ filePath: stats.filePath, error: stats.error });
            }
        }
        if (stats.frameRegexDetectedCount > 0) {
            summary.sitesWithFrameRegexDetected += 1;
        }
        if (stats.cmpWithNameCount > 0) {
            summary.sitesWithCmpName += 1;
        }
        if (stats.cmpsCount === 0) {
            summary.sitesWithCmpsEmpty += 1;
        }
        if (stats.siteHasPopup) {
            summary.sitesWithPopupByDefinition += 1;
        }

        if (stats.isGapSite) {
            summary.gapSites += 1;
            gapSitesByFrameCount.push({
                filePath: stats.filePath,
                host: stats.host,
                frameRegexWithoutPopupRegexCount: stats.frameRegexWithoutPopupRegexCount,
                frameRegexDetectedCount: stats.frameRegexDetectedCount,
                frameCount: stats.frameCount,
            });
        }

        if (stats.isGapSite) {
            for (const gap of stats.frameGapDetails) {
                const originKey = gap.origin || '(unknown-origin)';
                gapOriginCounts[originKey] = (gapOriginCounts[originKey] || 0) + 1;
                if (gapSitesExamples.length < sampleLimit) {
                    gapSitesExamples.push({
                        filePath: stats.filePath,
                        host: stats.host,
                        frameIndex: gap.frameIndex,
                        origin: gap.origin,
                        isTop: gap.isTop,
                        potentialPopupCount: gap.potentialPopupCount,
                        popupTextPreview: gap.popupTextPreview,
                    });
                }
            }
        }

        if (
            summary.processedFiles === 1 ||
            summary.processedFiles % progressEvery === 0 ||
            summary.processedFiles === summary.totalJsonFiles
        ) {
            const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
            const rate = (summary.processedFiles / elapsedSec).toFixed(1);
            console.log(`[progress] ${summary.processedFiles}/${summary.totalJsonFiles} files (${rate} files/s)`);
        }
    });

    const topGapOrigins = Object.entries(gapOriginCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_LIMIT)
        .map(([origin, count]) => ({ origin, count }));

    const gapSitesWithMostGapFrames = gapSitesByFrameCount
        .sort((a, b) => b.frameRegexWithoutPopupRegexCount - a.frameRegexWithoutPopupRegexCount)
        .slice(0, TOP_LIMIT);

    const report = {
        generatedAt: new Date().toISOString(),
        inputPath,
        outputPath,
        sampleLimit,
        concurrency,
        summary: {
            ...summary,
            gapRateAmongPopupSites: ratio(summary.gapSites, summary.sitesWithPopupByDefinition),
            frameRegexWithoutPopupRegexRateVsRegexFrames: ratio(
                summary.totalFramesWithRegexButNoPopupRegex,
                summary.totalFramesWithRegexPopupDetected
            ),
            frameRegexWithoutPopupRegexRateVsAllFrames: ratio(
                summary.totalFramesWithRegexButNoPopupRegex,
                summary.totalFrames
            ),
        },
        topGapOrigins,
        gapSitesWithMostGapFrames,
        gapSitesExamples,
        errors,
    };

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

    console.log('');
    console.log('Summary:');
    console.log(`- Processed files: ${summary.processedFiles}`);
    console.log(`- Files with errors: ${summary.filesWithErrors}`);
    console.log(`- Files without scrapedFrames: ${summary.filesWithoutScrapedFrames}`);
    console.log(`- Sites with popup (frame regex OR cmp name): ${summary.sitesWithPopupByDefinition}`);
    console.log(`- Sites with frame regex detected: ${summary.sitesWithFrameRegexDetected}`);
    console.log(`- Sites with non-empty cmp name: ${summary.sitesWithCmpName}`);
    console.log(`- Sites with empty cmps: ${summary.sitesWithCmpsEmpty}`);
    console.log(`- Gap sites (frame regex AND cmps empty AND no popup regex match): ${summary.gapSites}`);
    console.log(`- Gap rate among popup sites: ${report.summary.gapRateAmongPopupSites}`);
    console.log(`- Total frames: ${summary.totalFrames}`);
    console.log(`- Total cmps entries: ${summary.totalCmpsEntries}`);
    console.log(`- Total cmps with non-empty name: ${summary.totalCmpsWithName}`);
    console.log(`- Frames with regexPopupDetected=true: ${summary.totalFramesWithRegexPopupDetected}`);
    console.log(`- Frames with regexPopupDetected=true and no popup regexMatch=true: ${summary.totalFramesWithRegexButNoPopupRegex}`);
    console.log(`- Gap rate among regex-detected frames: ${report.summary.frameRegexWithoutPopupRegexRateVsRegexFrames}`);
    console.log(`- Total potentialPopups scanned: ${summary.totalPotentialPopups}`);
    console.log(`- Total popup-level regex matches: ${summary.totalPopupRegexMatches}`);
    console.log(`- Runtime: ${formatDuration(Date.now() - startedAt)}`);
    console.log('');
    console.log(`Report written to: ${outputPath}`);
}

main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});
