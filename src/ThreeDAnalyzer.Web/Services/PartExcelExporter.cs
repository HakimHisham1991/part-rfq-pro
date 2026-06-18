using ClosedXML.Excel;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public static class PartExcelExporter
{
    public static byte[] Export(IReadOnlyList<Part> parts)
    {
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("RFQ");

        for (var col = 0; col < PartExportRows.Headers.Length; col++)
            worksheet.Cell(1, col + 1).Value = PartExportRows.Headers[col];

        worksheet.Row(1).Style.Font.Bold = true;

        for (var rowIndex = 0; rowIndex < parts.Count; rowIndex++)
        {
            var values = PartExportRows.GetValues(parts[rowIndex]);
            var rowNumber = rowIndex + 2;
            for (var col = 0; col < values.Length; col++)
                worksheet.Cell(rowNumber, col + 1).Value = values[col];
        }

        worksheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return stream.ToArray();
    }
}
