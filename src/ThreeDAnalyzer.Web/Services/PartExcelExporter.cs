using ClosedXML.Excel;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public static class PartExcelExporter
{
    private static readonly (string Header, Action<IXLCell, Part> Write)[] Columns =
    [
        ("Aircraft", (c, p) => c.Value = p.Aircraft),
        ("No", (c, p) => c.Value = p.No),
        ("Part Number", (c, p) => c.Value = p.PartNumber),
        ("Part Description", (c, p) => c.Value = p.PartDescription),
        ("Picture", (c, p) => c.Value = p.Picture),
        ("QPA", (c, p) => c.Value = p.Qpa),
        ("1st launch quantity", (c, p) => c.Value = p.FirstLaunchQty),
        ("1st delivery", (c, p) => c.Value = p.FirstDelivery),
        ("MATERIAL SPEC", (c, p) => c.Value = p.MaterialSpec),
        ("FINISH SIZE (MM): THICKNESS / DIAMETER", (c, p) => c.Value = p.FinishThickness),
        ("FINISH SIZE (MM): WIDTH", (c, p) => c.Value = p.FinishWidth),
        ("FINISH SIZE (MM): LENGTH", (c, p) => c.Value = p.FinishLength),
        ("MATERIAL (MM): RULING DIM.", (c, p) => c.Value = p.MaterialRulingDim),
        ("MATERIAL (MM): THICKNESS / DIAMETER", (c, p) => c.Value = p.MaterialThickness),
        ("MATERIAL (MM): WIDTH", (c, p) => c.Value = p.MaterialWidth),
        ("MATERIAL (MM): LENGTH", (c, p) => c.Value = p.MaterialLength),
        ("QTY/BILLET", (c, p) => c.Value = p.QtyPerBillet),
        ("SETUP TIME (HOUR)", (c, p) => c.Value = p.SetupTimeHour),
        ("CYCLE TIME (HOUR): TurnMill", (c, p) => c.Value = p.CycleTurnMill),
        ("CYCLE TIME (HOUR): 3X", (c, p) => c.Value = p.Cycle3x),
        ("CYCLE TIME (HOUR): 4X", (c, p) => c.Value = p.Cycle4x),
        ("CYCLE TIME (HOUR): 5X", (c, p) => c.Value = p.Cycle5x),
        ("CYCLE TIME (HOUR): TOTAL HRS REQUIRE", (c, p) => c.Value = p.CycleTotalHrs)
    ];

    public static byte[] Export(IReadOnlyList<Part> parts)
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("RFQ");

        for (var col = 0; col < Columns.Length; col++)
            worksheet.Cell(1, col + 1).Value = Columns[col].Header;

        var headerRow = worksheet.Row(1);
        headerRow.Style.Font.Bold = true;

        for (var rowIndex = 0; rowIndex < parts.Count; rowIndex++)
        {
            var part = parts[rowIndex];
            var rowNumber = rowIndex + 2;
            for (var col = 0; col < Columns.Length; col++)
                Columns[col].Write(worksheet.Cell(rowNumber, col + 1), part);
        }

        worksheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
