using System.Text;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Services;

public static class PartDelimitedExporter
{
    private const char Separator = '|';

    public static byte[] Export(IReadOnlyList<Part> parts)
    {
        using var stream = new MemoryStream();
        using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

        writer.WriteLine(string.Join(Separator, PartExportRows.Headers));
        foreach (var part in parts)
        {
            var values = PartExportRows.GetValues(part).Select(SanitizeField);
            writer.WriteLine(string.Join(Separator, values));
        }

        writer.Flush();
        return stream.ToArray();
    }

    private static string SanitizeField(string value)
    {
        return (value ?? "")
            .Replace(Separator, ' ')
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();
    }
}
