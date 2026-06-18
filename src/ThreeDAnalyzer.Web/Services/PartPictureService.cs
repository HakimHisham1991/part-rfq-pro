namespace ThreeDAnalyzer.Web.Services;

public sealed class PartPictureService(IWebHostEnvironment env)
{
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpeg", ".jpg", ".png", ".gif", ".bmp", ".wmf", ".tif", ".tiff"
    };

    public static bool IsAllowedExtension(string? fileName)
    {
        var ext = Path.GetExtension(fileName ?? "");
        return AllowedExtensions.Contains(ext);
    }

    public async Task<string> SaveAsync(int projectId, int partId, IFormFile file)
    {
        if (file.Length == 0)
            throw new InvalidOperationException("Image file is required.");

        var ext = Path.GetExtension(file.FileName);
        if (!AllowedExtensions.Contains(ext))
            throw new InvalidOperationException("Allowed formats: jpeg, jpg, png, gif, bmp, wmf, tif.");

        var dir = GetStorageDirectory(projectId);
        Directory.CreateDirectory(dir);
        DeleteExistingFiles(dir, partId);

        var fileName = $"{partId}{ext.ToLowerInvariant()}";
        var fullPath = Path.Combine(dir, fileName);
        await using (var stream = File.Create(fullPath))
        {
            await file.CopyToAsync(stream);
        }

        return $"/uploads/part-pictures/{projectId}/{fileName}";
    }

    public void Delete(int projectId, int partId)
    {
        var dir = GetStorageDirectory(projectId);
        DeleteExistingFiles(dir, partId);
    }

    private string GetStorageDirectory(int projectId) =>
        Path.Combine(env.WebRootPath, "uploads", "part-pictures", projectId.ToString());

    private static void DeleteExistingFiles(string dir, int partId)
    {
        if (!Directory.Exists(dir)) return;

        foreach (var file in Directory.GetFiles(dir, $"{partId}.*"))
            File.Delete(file);
    }
}
