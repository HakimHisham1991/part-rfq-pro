using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/projects")]
public class ProjectsController(AppDbContext db) : ControllerBase
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

        var envelope = new { values = payload.Values, updatedAt = payload.UpdatedAt ?? DateTime.UtcNow.ToString("o") };
        part.CycleTimeDataJson = JsonSerializer.Serialize(envelope);

        if (payload.Values is { ValueKind: JsonValueKind.Object } el &&
            el.TryGetProperty("total.overallMin", out var minEl) &&
            minEl.TryGetDouble(out var totalMin))
        {
            part.CycleTotalHrs = Math.Round(totalMin / 60.0, 2);
        }

        await db.SaveChangesAsync();
        return NoContent();
    }
}
