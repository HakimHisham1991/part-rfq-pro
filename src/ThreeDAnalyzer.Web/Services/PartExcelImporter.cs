using ClosedXML.Excel;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public sealed class PartExcelImportResult
{
    public int Imported { get; set; }
    public int Skipped { get; set; }
    public List<string> Errors { get; set; } = [];
    public List<Part> Parts { get; set; } = [];
}

public static class PartExcelImporter
{
    private static readonly HashSet<string> KnownHeaders = BuildKnownHeaders();

    public static PartExcelImportResult Import(Stream stream, int projectId, int startNo)
    {
        using var workbook = new XLWorkbook(stream);
        var worksheet = workbook.Worksheets.FirstOrDefault();
        if (worksheet == null)
            return new PartExcelImportResult { Errors = ["Workbook has no worksheets."] };

        var headerRow = worksheet.FirstRowUsed();
        if (headerRow == null)
            return new PartExcelImportResult { Errors = ["Worksheet is empty."] };

        var columnKeys = MapHeaders(headerRow);
        if (!columnKeys.Values.Contains("PartNumber"))
            return new PartExcelImportResult { Errors = ["Missing required column: Part Number."] };

        var result = new PartExcelImportResult();
        var nextNo = startNo;

        foreach (var row in worksheet.RowsUsed().Skip(1))
        {
            var partNumber = ReadCell(row, columnKeys, "PartNumber").Trim();
            if (string.IsNullOrWhiteSpace(partNumber))
            {
                result.Skipped++;
                continue;
            }

            var part = new Part
            {
                ProjectId = projectId,
                PartNumber = partNumber,
                PartDescription = ReadCell(row, columnKeys, "PartDescription"),
                Aircraft = ReadCell(row, columnKeys, "Aircraft"),
                Picture = ReadCell(row, columnKeys, "Picture"),
                FirstDelivery = ReadCell(row, columnKeys, "FirstDelivery"),
                MaterialSpec = ReadCell(row, columnKeys, "MaterialSpec"),
                No = ReadInt(row, columnKeys, "No") ?? nextNo++,
                Qpa = ReadInt(row, columnKeys, "Qpa") ?? 0,
                FirstLaunchQty = ReadInt(row, columnKeys, "FirstLaunchQty") ?? 0,
                FinishThickness = ReadDouble(row, columnKeys, "FinishThickness") ?? 0,
                FinishWidth = ReadDouble(row, columnKeys, "FinishWidth") ?? 0,
                FinishLength = ReadDouble(row, columnKeys, "FinishLength") ?? 0,
                MaterialRulingDim = ReadDouble(row, columnKeys, "MaterialRulingDim") ?? 0,
                MaterialThickness = ReadDouble(row, columnKeys, "MaterialThickness") ?? 0,
                MaterialWidth = ReadDouble(row, columnKeys, "MaterialWidth") ?? 0,
                MaterialLength = ReadDouble(row, columnKeys, "MaterialLength") ?? 0,
                QtyPerBillet = ReadInt(row, columnKeys, "QtyPerBillet") ?? 0,
                SetupTimeHour = ReadDouble(row, columnKeys, "SetupTimeHour") ?? 0,
                CycleTurnMill = ReadDouble(row, columnKeys, "CycleTurnMill") ?? 0,
                Cycle3x = ReadDouble(row, columnKeys, "Cycle3x") ?? 0,
                Cycle4x = ReadDouble(row, columnKeys, "Cycle4x") ?? 0,
                Cycle5x = ReadDouble(row, columnKeys, "Cycle5x") ?? 0
            };
            part.CycleTotalHrs =
                part.SetupTimeHour + part.CycleTurnMill + part.Cycle3x + part.Cycle4x + part.Cycle5x;

            result.Parts.Add(part);
        }

        result.Imported = result.Parts.Count;
        return result;
    }

    private static Dictionary<int, string> MapHeaders(IXLRow headerRow)
    {
        var map = new Dictionary<int, string>();
        foreach (var cell in headerRow.CellsUsed())
        {
            var normalized = NormalizeHeader(cell.GetString());
            var key = ResolveColumnKey(normalized);
            if (key != null)
                map[cell.Address.ColumnNumber] = key;
        }

        return map;
    }

    private static string? ResolveColumnKey(string normalized)
    {
        if (KnownHeaders.Contains(normalized))
        {
            return normalized switch
            {
                "aircraft" => "Aircraft",
                "no" => "No",
                "part number" => "PartNumber",
                "part description" => "PartDescription",
                "picture" => "Picture",
                "qpa" => "Qpa",
                "1st launch quantity" or "first launch quantity" => "FirstLaunchQty",
                "1st delivery" or "first delivery" => "FirstDelivery",
                "material spec" => "MaterialSpec",
                "finish size (mm): thickness / diameter" => "FinishThickness",
                "finish size (mm): width" => "FinishWidth",
                "finish size (mm): length" => "FinishLength",
                "material (mm): ruling dim." => "MaterialRulingDim",
                "material (mm): thickness / diameter" => "MaterialThickness",
                "material (mm): width" => "MaterialWidth",
                "material (mm): length" => "MaterialLength",
                "qty/billet" => "QtyPerBillet",
                "setup time (hour)" => "SetupTimeHour",
                "cycle time (hour): turnmill" => "CycleTurnMill",
                "cycle time (hour): 3x" => "Cycle3x",
                "cycle time (hour): 4x" => "Cycle4x",
                "cycle time (hour): 5x" => "Cycle5x",
                "cycle time (hour): total hrs require" => "CycleTotalHrs",
                _ => null
            };
        }

        return null;
    }

    private static string NormalizeHeader(string? value)
    {
        return (value ?? "")
            .Trim()
            .ToLowerInvariant()
            .Replace('\n', ' ')
            .Replace('\r', ' ');
    }

    private static string ReadCell(IXLRow row, Dictionary<int, string> columnKeys, string key)
    {
        foreach (var (col, mapped) in columnKeys)
        {
            if (mapped != key) continue;
            return row.Cell(col).GetString().Trim();
        }

        return "";
    }

    private static int? ReadInt(IXLRow row, Dictionary<int, string> columnKeys, string key)
    {
        var text = ReadCell(row, columnKeys, key);
        if (string.IsNullOrWhiteSpace(text)) return null;
        if (int.TryParse(text, out var value)) return value;
        if (double.TryParse(text, out var d)) return (int)Math.Round(d);
        return null;
    }

    private static double? ReadDouble(IXLRow row, Dictionary<int, string> columnKeys, string key)
    {
        var text = ReadCell(row, columnKeys, key);
        if (string.IsNullOrWhiteSpace(text)) return null;
        return double.TryParse(text, out var value) ? value : null;
    }

    private static HashSet<string> BuildKnownHeaders()
    {
        return
        [
            "aircraft",
            "no",
            "part number",
            "part description",
            "picture",
            "qpa",
            "1st launch quantity",
            "first launch quantity",
            "1st delivery",
            "first delivery",
            "material spec",
            "finish size (mm): thickness / diameter",
            "finish size (mm): width",
            "finish size (mm): length",
            "material (mm): ruling dim.",
            "material (mm): thickness / diameter",
            "material (mm): width",
            "material (mm): length",
            "qty/billet",
            "setup time (hour)",
            "cycle time (hour): turnmill",
            "cycle time (hour): 3x",
            "cycle time (hour): 4x",
            "cycle time (hour): 5x",
            "cycle time (hour): total hrs require",
            "action"
        ];
    }
}
