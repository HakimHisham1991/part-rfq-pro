using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;
using ThreeDAnalyzer.Web.Services;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/projects")]
public class ProjectsController(AppDbContext db, PartPictureService pictureService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<ProjectDto>>> List()
    {
        var items = await db.Projects.OrderBy(p => p.Name).ToListAsync();
        return items.Select(p => p.ToDto()).ToList();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ProjectDto>> Get(int id)
    {
        var project = await db.Projects.FindAsync(id);
        return project == null ? NotFound() : project.ToDto();
    }

    [HttpPost]
    public async Task<ActionResult<ProjectDto>> Create([FromBody] CreateProjectRequest request)
    {
        var name = (request.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            return BadRequest("Project name is required.");

        if (await db.Projects.AnyAsync(p => p.Name == name))
            return BadRequest($"Project \"{name}\" already exists.");

        var status = (request.Status ?? "Open").Trim();
        if (status is not "Open" and not "Closed")
            return BadRequest("Status must be Open or Closed.");

        DateOnly dateRegistered;
        if (string.IsNullOrWhiteSpace(request.DateRegistered))
        {
            dateRegistered = DateOnly.FromDateTime(DateTime.UtcNow);
        }
        else if (!DateOnly.TryParse(request.DateRegistered, out dateRegistered))
        {
            return BadRequest("Date Registered must be a valid date (yyyy-MM-dd).");
        }

        var project = new Project
        {
            Name = name,
            Owner = (request.Owner ?? "").Trim(),
            DateRegistered = dateRegistered,
            Status = status
        };

        db.Projects.Add(project);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, project.ToDto());
    }

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<ProjectDto>> UpdateStatus(int id, [FromBody] UpdateProjectStatusRequest request)
    {
        var project = await db.Projects.FindAsync(id);
        if (project == null) return NotFound();

        var status = (request.Status ?? "").Trim();
        if (status is not "Open" and not "Closed")
            return BadRequest("Status must be Open or Closed.");

        project.Status = status;
        await db.SaveChangesAsync();
        return project.ToDto();
    }

    [HttpPut("{id:int}/name")]
    public async Task<ActionResult<ProjectDto>> Rename(int id, [FromBody] RenameProjectRequest request)
    {
        var project = await db.Projects.FindAsync(id);
        if (project == null) return NotFound();

        var name = (request.Name ?? "").Trim();
        if (string.IsNullOrEmpty(name))
            return BadRequest("Project name is required.");

        if (await db.Projects.AnyAsync(p => p.Id != id && p.Name == name))
            return BadRequest($"Project \"{name}\" already exists.");

        project.Name = name;
        await db.SaveChangesAsync();
        return project.ToDto();
    }

    [HttpGet("{projectId:int}/parts")]
    public async Task<ActionResult<List<PartDto>>> ListParts(int projectId)
    {
        if (!await db.Projects.AnyAsync(p => p.Id == projectId)) return NotFound();

        var parts = await db.Parts
            .Where(p => p.ProjectId == projectId)
            .OrderBy(p => p.No)
            .ToListAsync();
        return parts.Select(p => p.ToDto()).ToList();
    }

    [HttpGet("{projectId:int}/parts/{partId:int}")]
    public async Task<ActionResult<PartDto>> GetPart(int projectId, int partId)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        return part == null ? NotFound() : part.ToDto();
    }

    [HttpGet("{projectId:int}/parts/{partId:int}/cycle-time")]
    public async Task<ActionResult<CycleTimeResponse>> GetCycleTime(int projectId, int partId)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();
        if (string.IsNullOrEmpty(part.CycleTimeDataJson)) return new CycleTimeResponse(null);

        var data = JsonSerializer.Deserialize<object>(part.CycleTimeDataJson);
        return new CycleTimeResponse(data);
    }

    [HttpPut("{projectId:int}/parts/{partId:int}/cycle-time")]
    public async Task<IActionResult> SaveCycleTime(int projectId, int partId, [FromBody] CycleTimePayload payload)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();

        var updatedAt = payload.UpdatedAt ?? DateTime.UtcNow.ToString("o");
        object envelope;
        if (payload.Version == 2)
        {
            envelope = new
            {
                version = 2,
                operations = payload.Operations,
                other = payload.Other,
                rawMaterial = payload.RawMaterial,
                finishPart = payload.FinishPart,
                model3d = payload.Model3d,
                computed = payload.Computed,
                updatedAt
            };
        }
        else
        {
            envelope = new { values = payload.Values, updatedAt };
        }

        part.CycleTimeDataJson = JsonSerializer.Serialize(envelope);

        // CycleTotalHrs on the RFQ table is Setup + TurnMill + 3X + 4X + 5X
        // (computed on part update). Do not overwrite it from Cycle Time minutes.

        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{projectId:int}/parts")]
    public async Task<ActionResult<PartDto>> CreatePart(int projectId, [FromBody] CreatePartRequest request)
    {
        var project = await db.Projects.FindAsync(projectId);
        if (project == null) return NotFound();

        var partNumber = (request.PartNumber ?? "").Trim();
        if (string.IsNullOrEmpty(partNumber))
            return BadRequest("Part number is required.");

        if (await db.Parts.AnyAsync(p => p.ProjectId == projectId && p.PartNumber == partNumber))
            return BadRequest($"Part number \"{partNumber}\" already exists in this project.");

        var nextNo = await db.Parts.Where(p => p.ProjectId == projectId).MaxAsync(p => (int?)p.No) ?? 0;
        var aircraft = await db.Parts
            .Where(p => p.ProjectId == projectId && p.Aircraft != "")
            .Select(p => p.Aircraft)
            .FirstOrDefaultAsync();

        var part = new Part
        {
            ProjectId = projectId,
            PartNumber = partNumber,
            PartDescription = (request.PartDescription ?? "").Trim(),
            Aircraft = aircraft ?? "",
            No = nextNo + 1
        };

        db.Parts.Add(part);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, part.ToDto());
    }

    [HttpPut("{projectId:int}/parts/{partId:int}")]
    public async Task<ActionResult<PartDto>> UpdatePart(
        int projectId,
        int partId,
        [FromBody] UpdatePartRequest request)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();

        var partNumber = (request.PartNumber ?? "").Trim();
        if (string.IsNullOrEmpty(partNumber))
            return BadRequest("Part number is required.");

        if (request.No <= 0)
            return BadRequest("No. must be greater than zero.");

        if (await db.Parts.AnyAsync(p =>
                p.ProjectId == projectId && p.Id != partId && p.PartNumber == partNumber))
            return BadRequest($"Part number \"{partNumber}\" already exists in this project.");

        part.Aircraft = (request.Aircraft ?? "").Trim();
        part.No = request.No;
        part.PartNumber = partNumber;
        part.PartDescription = (request.PartDescription ?? "").Trim();
        part.Picture = (request.Picture ?? "").Trim();
        part.Qpa = request.Qpa;
        part.FirstLaunchQty = request.FirstLaunchQty;
        part.FirstDelivery = (request.FirstDelivery ?? "").Trim();
        part.MaterialSpec = (request.MaterialSpec ?? "").Trim();
        part.FinishThickness = request.FinishThickness;
        part.FinishWidth = request.FinishWidth;
        part.FinishLength = request.FinishLength;
        part.MaterialRulingDim = request.MaterialRulingDim;
        part.MaterialThickness = request.MaterialThickness;
        part.MaterialWidth = request.MaterialWidth;
        part.MaterialLength = request.MaterialLength;
        part.QtyPerBillet = request.QtyPerBillet;
        part.SetupTimeHour = request.SetupTimeHour;
        part.CycleTurnMill = request.CycleTurnMill;
        part.Cycle3x = request.Cycle3x;
        part.Cycle4x = request.Cycle4x;
        part.Cycle5x = request.Cycle5x;
        // TOTAL HRS REQUIRE is always derived — not user-editable
        part.CycleTotalHrs =
            part.SetupTimeHour + part.CycleTurnMill + part.Cycle3x + part.Cycle4x + part.Cycle5x;

        await db.SaveChangesAsync();
        return part.ToDto();
    }

    [HttpDelete("{projectId:int}/parts/{partId:int}")]
    public async Task<IActionResult> DeletePart(int projectId, int partId)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();

        pictureService.Delete(projectId, partId);
        db.Parts.Remove(part);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{projectId:int}/parts/{partId:int}/picture")]
    [RequestSizeLimit(5 * 1024 * 1024)]
    public async Task<ActionResult<PartDto>> UploadPartPicture(
        int projectId,
        int partId,
        IFormFile? file)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();

        if (file == null || file.Length == 0)
            return BadRequest("Image file is required.");

        if (!PartPictureService.IsAllowedExtension(file.FileName))
            return BadRequest("Allowed formats: jpeg, jpg, png, gif, bmp, wmf, tif.");

        try
        {
            part.Picture = await pictureService.SaveAsync(projectId, partId, file);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }

        await db.SaveChangesAsync();
        return part.ToDto();
    }

    [HttpDelete("{projectId:int}/parts/{partId:int}/picture")]
    public async Task<ActionResult<PartDto>> DeletePartPicture(int projectId, int partId)
    {
        var part = await db.Parts.FirstOrDefaultAsync(p => p.ProjectId == projectId && p.Id == partId);
        if (part == null) return NotFound();

        pictureService.Delete(projectId, partId);
        part.Picture = "";
        await db.SaveChangesAsync();
        return part.ToDto();
    }

    [HttpGet("{projectId:int}/parts/export")]
    public async Task<IActionResult> ExportParts(int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);
        if (project == null) return NotFound();

        var parts = await GetOrderedParts(projectId);
        var bytes = PartExcelExporter.Export(parts);
        var fileName = BuildExportFileName(project, projectId, "xlsx");

        return File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            fileName);
    }

    [HttpGet("{projectId:int}/parts/export/csv")]
    public async Task<IActionResult> ExportPartsCsv(int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);
        if (project == null) return NotFound();

        var parts = await GetOrderedParts(projectId);
        var bytes = PartDelimitedExporter.Export(parts);
        var fileName = BuildExportFileName(project, projectId, "csv");

        return File(bytes, "text/csv", fileName);
    }

    [HttpGet("{projectId:int}/parts/export/txt")]
    public async Task<IActionResult> ExportPartsTxt(int projectId)
    {
        var project = await db.Projects.FindAsync(projectId);
        if (project == null) return NotFound();

        var parts = await GetOrderedParts(projectId);
        var bytes = PartDelimitedExporter.Export(parts);
        var fileName = BuildExportFileName(project, projectId, "txt");

        return File(bytes, "text/plain", fileName);
    }

    private async Task<List<Part>> GetOrderedParts(int projectId) =>
        await db.Parts
            .Where(p => p.ProjectId == projectId)
            .OrderBy(p => p.No)
            .ToListAsync();

    private static string BuildExportFileName(Project project, int projectId, string extension)
    {
        var safeName = string.Join("_", project.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries)).Trim();
        if (string.IsNullOrEmpty(safeName)) safeName = $"project-{projectId}";
        return $"{safeName}-rfq.{extension}";
    }

    [HttpPost("{projectId:int}/parts/import")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<ImportPartsResult>> ImportParts(int projectId, IFormFile? file)
    {
        var project = await db.Projects.FindAsync(projectId);
        if (project == null) return NotFound();

        if (file == null || file.Length == 0)
            return BadRequest("Excel file is required.");

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension is not ".xlsx" and not ".xls")
            return BadRequest("Only .xlsx and .xls files are supported.");

        var startNo = await db.Parts.Where(p => p.ProjectId == projectId).MaxAsync(p => (int?)p.No) ?? 0;

        PartExcelImportResult importResult;
        await using (var stream = file.OpenReadStream())
        {
            importResult = PartExcelImporter.Import(stream, projectId, startNo + 1);
        }

        if (importResult.Errors.Count > 0)
            return BadRequest(new ImportPartsResult(0, importResult.Skipped, importResult.Errors));

        if (importResult.Parts.Count == 0)
            return BadRequest(new ImportPartsResult(0, importResult.Skipped, ["No part rows found in the Excel file."]));

        var existingNumbers = await db.Parts
            .Where(p => p.ProjectId == projectId)
            .Select(p => p.PartNumber)
            .ToListAsync();
        var existingSet = existingNumbers.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var errors = new List<string>();
        var toAdd = new List<Part>();
        foreach (var part in importResult.Parts)
        {
            if (existingSet.Contains(part.PartNumber))
            {
                errors.Add($"Skipped duplicate part number \"{part.PartNumber}\".");
                importResult.Skipped++;
                continue;
            }

            existingSet.Add(part.PartNumber);
            toAdd.Add(part);
        }

        if (toAdd.Count == 0)
            return BadRequest(new ImportPartsResult(0, importResult.Skipped, errors));

        db.Parts.AddRange(toAdd);
        await db.SaveChangesAsync();

        return new ImportPartsResult(toAdd.Count, importResult.Skipped, errors);
    }
}
